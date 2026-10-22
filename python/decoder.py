
import gc
import glob
import json
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pyModeS as pms
from dotenv import load_dotenv
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from supabase import create_client, Client


# These settings follow the prediction notebook. Predictions are generated at
# 10-second intervals and extend 3 steps beyond the latest real position.
N_PREDICTED_STEPS = 1
STEP_SECONDS = 10
MAX_TRAINING_SAMPLES = 2_000_000


def fetch_all_rows(table_name):
    all_data = []
    page_size = 1000
    start = 0

    while True:
        response = (
            supabase.table(table_name)
            .select("*")
            .eq("used", False)
            .range(start, start + page_size - 1)
            .execute()
        )

        data = response.data
        if not data:
            break

        all_data.extend(data)
        start += page_size

    return all_data

def fetch_all_table_rows(table_name):
    """Fetch every row from a table, with pagination (without filtering by used)."""
    all_data = []
    page_size = 1000
    start = 0

    while True:
        response = (
            supabase.table(table_name)
            .select("*")
            .range(start, start + page_size - 1)
            .execute()
        )
        data = response.data or []
        if not data:
            break
        all_data.extend(data)
        start += len(data)
        if len(data) < page_size:
            break

    return all_data


def _read_training_csv(path):
    """Read only columns required by the notebook's trajectory model."""
    try:
        columns = list(pd.read_csv(path, nrows=0).columns)
    except Exception as exc:
        print(f"Skipping training CSV {path}: could not read header ({exc})")
        return None

    aliases = {
        "icao24": ("icao24", "icao"),
        "callsign": ("callsign",),
        "time": ("time", "timestamp"),
        "lat": ("lat", "latitude"),
        "lon": ("lon", "longitude"),
    }
    selected = {}
    for target, options in aliases.items():
        source = next((name for name in options if name in columns), None)
        if source is None:
            print(f"Skipping training CSV {path}: missing required {target} column")
            return None
        selected[source] = target

    try:
        frame = pd.read_csv(path, usecols=list(selected.keys()), low_memory=False)
    except Exception as exc:
        print(f"Skipping training CSV {path}: could not read data ({exc})")
        return None

    return frame.rename(columns=selected)[["icao24", "callsign", "time", "lat", "lon"]]


def _make_training_xy(frame):
    """Build the same next-position delta features used in the notebook."""
    frame = frame.sort_values(["icao24", "callsign", "time"]).reset_index(drop=True)
    grouped = frame.groupby(["icao24", "callsign"], sort=False)
    derived = frame.assign(
        prev_lat=grouped["lat"].shift(1),
        prev_lon=grouped["lon"].shift(1),
        next_lat=grouped["lat"].shift(-1),
        next_lon=grouped["lon"].shift(-1),
        dt=grouped["time"].diff(),
    ).dropna(subset=["lat", "lon", "prev_lat", "prev_lon", "next_lat", "next_lon", "dt"])
    derived = derived[derived["dt"] > 0]

    if derived.empty:
        raise ValueError("Training CSVs did not contain consecutive positions with increasing timestamps")

    X = np.column_stack((
        derived["lat"].to_numpy(dtype=np.float64),
        derived["lon"].to_numpy(dtype=np.float64),
        ((derived["lat"] - derived["prev_lat"]) / derived["dt"]).to_numpy(dtype=np.float64),
        ((derived["lon"] - derived["prev_lon"]) / derived["dt"]).to_numpy(dtype=np.float64),
    ))
    y = np.column_stack((
        (derived["next_lat"] - derived["lat"]).to_numpy(dtype=np.float64),
        (derived["next_lon"] - derived["lon"]).to_numpy(dtype=np.float64),
    ))
    return X, y


def train_prediction_model():
    """Load training data and fit the model once, before entering the main loop."""
    csv_paths = glob.glob("data/*.csv")
    if not csv_paths:
        raise FileNotFoundError(
            "No training CSV files found. Put notebook-compatible CSVs in a data/ folder "
            "or set ADSB_TRAINING_DATA_GLOB to a CSV path/pattern."
        )

    print(f"Loading prediction training data from {len(csv_paths)} CSV file(s)...")
    frames = []
    for path in csv_paths:
        frame = _read_training_csv(path)
        if frame is not None and not frame.empty:
            frames.append(frame)

    if not frames:
        raise ValueError(
            "No training CSV had the required columns: icao24/callsign/time/lat/lon "
            "(or the supported aliases icao/timestamp/latitude/longitude)."
        )

    training_df = pd.concat(frames, ignore_index=True)
    del frames

    # Keep only valid records used by the model; unrelated columns in source
    # CSVs (e.g. trajectory exports) are intentionally not used.
    raw_time = training_df["time"].copy()
    numeric_time = pd.to_numeric(raw_time, errors="coerce")
    if numeric_time.isna().any():
        parsed_time = pd.to_datetime(raw_time, utc=True, errors="coerce")
        parsed_seconds = parsed_time.astype("int64").where(parsed_time.notna(), np.nan) / 1e9
        numeric_time = numeric_time.fillna(parsed_seconds)
    training_df["time"] = numeric_time

    for col in ("lat", "lon"):
        training_df[col] = pd.to_numeric(training_df[col], errors="coerce")
    training_df["icao24"] = training_df["icao24"].astype("string").str.strip()
    training_df["callsign"] = training_df["callsign"].astype("string").str.strip()
    training_df = training_df.dropna(subset=["icao24", "callsign", "time", "lat", "lon"])
    training_df = training_df[
        (training_df["lat"].between(-90, 90)) &
        (training_df["lon"].between(-180, 180))
    ]
    training_df = training_df.drop_duplicates(
        subset=["icao24", "callsign", "time", "lat", "lon"]
    )

    if training_df.empty:
        raise ValueError("No valid training positions remain after cleaning the CSV files")

    X, y = _make_training_xy(training_df)
    print(f"Prepared {len(X):,} training transitions; fitting scaler and model...")

    scaler = StandardScaler()
    scaler.fit(X)

    sample_count = min(MAX_TRAINING_SAMPLES, len(X))
    sample_indices = np.random.default_rng(42).choice(
        len(X), size=sample_count, replace=False
    )
    model = RandomForestRegressor(
        n_estimators=100,
        n_jobs=-1,
        random_state=42,
    )
    model.fit(scaler.transform(X[sample_indices]), y[sample_indices])

    print(f"Prediction model ready (trained on {sample_count:,} sampled transitions).")
    del training_df, X, y, sample_indices
    gc.collect()
    return model, scaler


def _is_predicted_point(point):
    value = point.get("pred", False)
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def _number(value):
    try:
        result = float(value)
        return result if np.isfinite(result) else None
    except (TypeError, ValueError):
        return None
    
    
def normalize_icao(value):
    """Normalize ICAO24 identifiers to uppercase."""
    if value is None:
        return None

    value = str(value).strip()
    return value.upper() if value else None


def predict_and_store_trajectories(model, scaler):
    """Forecast each trajectory's next points and persist them as pred=True rows."""
    trajectory_rows = fetch_all_table_rows("trajectory")
    inserted_count = 0
    skipped_count = 0

    for row in trajectory_rows:
        icao = normalize_icao(row.get("icao") or row.get("icao24"))
        callsign = row.get("callsign")
        raw_trajectory = row.get("trajectory")

        if not icao or not callsign or raw_trajectory is None:
            skipped_count += 1
            continue

        if isinstance(raw_trajectory, str):
            try:
                points = json.loads(raw_trajectory)
            except (TypeError, json.JSONDecodeError):
                print(f"Skipping trajectory {icao}/{callsign}: malformed trajectory JSON")
                skipped_count += 1
                continue
        else:
            points = raw_trajectory

        if not isinstance(points, list):
            skipped_count += 1
            continue

        valid_points = []
        for point in points:
            if not isinstance(point, dict):
                continue
            lat = _number(point.get("lat"))
            lon = _number(point.get("lon"))
            timestamp = _number(point.get("timestamp"))
            if lat is None or lon is None or timestamp is None:
                continue
            normalized = dict(point)
            normalized["lat"] = lat
            normalized["lon"] = lon
            normalized["timestamp"] = int(timestamp)
            valid_points.append(normalized)

        real_points = sorted(
            (point for point in valid_points if not _is_predicted_point(point)),
            key=lambda point: point["timestamp"],
        )
        predicted_points = [point for point in valid_points if _is_predicted_point(point)]

        if len(real_points) < 2:
            skipped_count += 1
            continue

        last = real_points[-1]
        previous = next(
            (point for point in reversed(real_points[:-1])
             if point["timestamp"] < last["timestamp"]),
            None,
        )
        if previous is None:
            skipped_count += 1
            continue

        dt = last["timestamp"] - previous["timestamp"]
        if dt <= 0:
            skipped_count += 1
            continue

        expected_timestamps = {
            last["timestamp"],
            *(
                last["timestamp"] + step * STEP_SECONDS
                for step in range(1, N_PREDICTED_STEPS + 1)
            ),
        }

        existing_pred_timestamps = {
            point["timestamp"] for point in predicted_points
        }

        # Skip only when the anchor and all forecast points already exist.
        if expected_timestamps.issubset(existing_pred_timestamps):
            continue

        cur_lat = last["lat"]
        cur_lon = last["lon"]
        v_lat = (last["lat"] - previous["lat"]) / dt
        v_lon = (last["lon"] - previous["lon"]) / dt

        # Anchor the predicted trajectory to the last real position.
        predicted_rows = [{
            "icao": icao,
            "callsign": callsign,
            "lat": last["lat"],
            "lon": last["lon"],
            "altitude": last.get("altitude"),
            "timestamp": last["timestamp"],
            "pred": True,
        }]

        forecast_valid = True

        for step in range(1, N_PREDICTED_STEPS + 1):
            features = np.array([[cur_lat, cur_lon, v_lat, v_lon]], dtype=np.float64)
            delta_lat, delta_lon = model.predict(scaler.transform(features))[0]
            cur_lat += float(delta_lat)
            cur_lon += float(delta_lon)

            # Wrap longitude at the antimeridian; reject impossible latitude.
            cur_lon = ((cur_lon + 180.0) % 360.0) - 180.0
            if not np.isfinite(cur_lat) or not np.isfinite(cur_lon) or not -90 <= cur_lat <= 90:
                forecast_valid = False
                break

            predicted_rows.append({
                "icao": icao,
                "callsign": callsign,
                "lat": cur_lat,
                "lon": cur_lon,
                # The model predicts lat/lon only, so retain the last known altitude.
                "altitude": last.get("altitude"),
                "timestamp": last["timestamp"] + step * STEP_SECONDS,
                "pred": True,
            })

            # Feed the predicted movement back into the next model step.
            v_lat = float(delta_lat) / STEP_SECONDS
            v_lon = float(delta_lon) / STEP_SECONDS

        if not forecast_valid or len(predicted_rows) != N_PREDICTED_STEPS + 1:
            print(f"Skipping forecast for {icao}/{callsign}: model produced invalid coordinates")
            skipped_count += 1
            continue

        try:
            # Replace stale predictions for this aircraft/flight before writing
            # a new forecast based on its newest real position.
            (
                supabase.table("position_data")
                .delete()
                .eq("icao", icao)
                .eq("callsign", callsign)
                .eq("pred", True)
                .execute()
            )
            supabase.table("position_data").insert(predicted_rows).execute()
            inserted_count += len(predicted_rows)
            print(
                f"Stored {len(predicted_rows)} predicted positions for {icao}/{callsign} "
                f"through timestamp {predicted_rows[-1]['timestamp']}."
            )
        except Exception as exc:
            print(f"Failed to store forecast for {icao}/{callsign}: {exc}")

    print(
        f"Prediction pass finished: inserted {inserted_count} predicted point(s); "
        f"skipped {skipped_count} trajectory/trajectory issue(s)."
    )
    return inserted_count


def expire_old_messages():
    """Mark unused messages older than 24 hours as expired."""
    cutoff_timestamp = int(time.time()) - 86400

    response = (
        supabase.table("raw_msg")
        .update({
            "used": True,
            "error": False
        })
        .eq("used", False)
        .lt("timestamp", cutoff_timestamp)
        .execute()
    )

    expired_count = len(response.data or [])
    print(
        f"Expired {expired_count} old messages "
        f"(older than 24 hours)."
    )

class ADSBClient:
    def __init__(self):
        super(ADSBClient, self).__init__()
        self.callsigns = {}  # ICAO -> callsign
        self.buffers = {}    # ICAO -> list of pending messages

        # ICAO -> latest even/odd CPR position messages
        # self.cpr_cache = {}

    def mark_message(self, message, error=False, reason=""):
        """Update message status in Supabase."""
        try:
            supabase.table("raw_msg").update({
                "used": True,
                "error": error
            }).eq("id", message["id"]).execute()

            status = "ERROR" if error else "PROCESSED"
            print(
                f"Message {message['id']}: {status}"
                + (f" - {reason}" if reason else "")
            )

        except Exception as e:
            print(
                f"Failed to update message {message['id']}: {e}"
            )
            raise

    def flush_buffer(self, icao):
        """Process buffered messages once a callsign is available."""
        if icao not in self.buffers:
            return

        callsign = self.callsigns.get(icao)
        if not callsign:
            return

        # Keep entries until they have been successfully processed.
        pending = self.buffers[icao]

        while pending:
            entry = pending[0]

            if entry["type"] == "position":
                supabase.table("position_data").insert({
                    "icao": icao,
                    "callsign": callsign,
                    "lat": entry["lat"],
                    "lon": entry["lon"],
                    "altitude": entry["altitude"],
                    "timestamp": entry["timestamp"],
                    "pred": False
                }).execute()

            elif entry["type"] == "velocity":
                supabase.table("velocity_data").insert({
                    "icao": icao,
                    "callsign": callsign,
                    "speed": entry["speed"],
                    "heading": entry["heading"],
                    "vertical_rate": entry["vertical_rate"],
                    "speed_type": entry["speed_type"],
                    "timestamp": entry["timestamp"]
                }).execute()

            # Mark used only after the data insert succeeds.
            self.mark_message(
                {"id": entry["msg_id"]},
                error=False,
                reason="Buffered message processed"
            )

            paired_msg_id = entry.get("paired_msg_id")
            if paired_msg_id is not None:
                self.mark_message(
                    {"id": paired_msg_id},
                    error=False,
                    reason="Paired CPR message processed"
                )

            # Remove only the successfully processed entry.
            pending.pop(0)

        del self.buffers[icao]

    def handle_messages(self, messages):
        for message in messages:
            if message.get("used", False):
                continue

            msg = message.get("msg", "")

            # --- VALIDATE MESSAGE LENGTH ---
            if not isinstance(msg, str) or len(msg) != 28:
                self.mark_message(
                    message,
                    error=True,
                    reason="Invalid message length"
                )
                continue

            # --- VALIDATE DOWNLINK FORMAT AND CRC ---
            try:
                df = pms.df(msg)

                if df != 17:
                    self.mark_message(
                        message,
                        error=True,
                        reason="Not an ADS-B message (DF != 17)"
                    )
                    continue

                if pms.crc(msg) != 0:
                    self.mark_message(
                        message,
                        error=True,
                        reason="CRC validation failed"
                    )
                    continue

            except Exception as e:
                # Parsing/validation failure, not a database failure.
                self.mark_message(
                    message,
                    error=True,
                    reason=f"Message validation exception: {e}"
                )
                continue

            # --- EXTRACT AIRCRAFT INFORMATION ---
            try:
                raw_timestamp = message.get("timestamp")
                if raw_timestamp is None:
                    self.mark_message(
                        message,
                        error=True,
                        reason="Missing message timestamp"
                    )
                    continue
                try:
                    timestamp = int(raw_timestamp)
                except (TypeError, ValueError):
                    self.mark_message(
                        message,
                        error=True,
                        reason="Invalid message timestamp"
                    )
                    continue

                icao = normalize_icao(pms.adsb.icao(msg))
                tc = pms.adsb.typecode(msg)

                # --- CALLSIGN: TYPE CODES 1-4 ---
                if 1 <= tc <= 4:
                    callsign = pms.adsb.callsign(msg).strip()

                    if not callsign:
                        self.mark_message(
                            message,
                            error=True,
                            reason="Empty callsign"
                        )
                        continue

                    self.callsigns[icao] = callsign
                    print(f"Callsign updated: {icao} -> {callsign}")

                    # Flush buffered messages before marking the
                    # callsign message as successfully processed.
                    self.flush_buffer(icao)

                    self.mark_message(
                        message,
                        error=False,
                        reason="Callsign processed"
                    )
                    continue

                callsign = self.callsigns.get(icao)

                # --- POSITION: TYPE CODES 5-18 ---
                if 5 <= tc <= 18:
                    # Decode a single message against the receiver's location.
                    # Airborne (TC 9-18) must be within ~180 NM of the reference,
                    # surface (TC 5-8) within ~45 NM.
                    lat, lon = pms.adsb.position_with_ref(
                        msg, det_coords[0], det_coords[1]
                    )

                    if lat is None or lon is None:
                        self.mark_message(
                            message,
                            error=True,
                            reason="Could not decode position"
                        )
                        continue

                    altitude = (
                        pms.adsb.altitude(msg)
                        if 9 <= tc <= 18
                        else None
                    )

                    if callsign:
                        supabase.table("position_data").insert({
                            "icao": icao,
                            "callsign": callsign,
                            "lat": lat,
                            "lon": lon,
                            "altitude": altitude,
                            "timestamp": timestamp,
                            "pred": False
                        }).execute()

                        self.mark_message(
                            message,
                            error=False,
                            reason="Position processed"
                        )

                    else:
                        # No callsign yet: buffer the decoded position.
                        self.buffers.setdefault(icao, []).append({
                            "msg_id": message["id"],
                            "type": "position",
                            "lat": lat,
                            "lon": lon,
                            "altitude": altitude,
                            "timestamp": timestamp
                        })

                # --- VELOCITY: TYPE CODE 19 ---  
                elif tc == 19:
                    velocity = pms.adsb.velocity(msg)

                    speed = (
                        int(velocity[0])
                        if velocity[0] is not None else None
                    )
                    heading = (
                        int(velocity[1])
                        if velocity[1] is not None else None
                    )
                    vertical_rate = (
                        int(velocity[2])
                        if velocity[2] is not None else None
                    )

                    # The database requires a non-null heading.
                    # Reject this message if pyModeS cannot decode one.
                    if heading is None:
                        self.mark_message(
                            message,
                            error=True,
                            reason="Velocity message has no heading"
                        )
                        continue

                    if callsign:
                        supabase.table("velocity_data").insert({
                            "icao": icao,
                            "callsign": callsign,
                            "speed": speed,
                            "heading": heading,
                            "vertical_rate": vertical_rate,
                            "speed_type": velocity[3],
                            "timestamp": timestamp
                        }).execute()

                        self.mark_message(
                            message,
                            error=False,
                            reason="Velocity processed"
                        )

                    else:
                        self.buffers.setdefault(icao, []).append({
                            "msg_id": message["id"],
                            "type": "velocity",
                            "speed": speed,
                            "heading": heading,
                            "vertical_rate": vertical_rate,
                            "speed_type": velocity[3],
                            "timestamp": timestamp
                        })

                # --- UNSUPPORTED TYPE CODE ---
                else:
                    self.mark_message(
                        message,
                        error=True,
                        reason=f"Unsupported type code: {tc}"
                    )

            except Exception as e:
                # Do not mark the message as erroneous here:
                # this could be a temporary database/API failure.
                # Leave it unused so it can be retried.
                print(
                    f"Error processing message {message['id']}: {e}"
                )


det_coords = [-23.64699287757069, -46.57313694232773]
supabase: Client


def main():
    global supabase

    load_dotenv()
    url: str = os.environ.get("SUPABASE_URL")
    key: str = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in the environment or .env file")
    supabase = create_client(url, key)

    # Load and train once, outside the while loop. If the training CSVs are absent,
    # ADS-B decoding continues, but trajectory prediction is disabled until fixed.
    prediction_model = None
    prediction_scaler = None
    try:
        prediction_model, prediction_scaler = train_prediction_model()
    except Exception as exc:
        print(f"WARNING: trajectory prediction is disabled: {exc}")

    client = ADSBClient()
    last_db_chore_timestamp = 0

    while True:
        # Perform database chores every 5 minutes.
        if time.time() - last_db_chore_timestamp >= 300:
            print("Performing database chores...")
            try:
                # 1. Rebuild trajectories from the currently stored positions.
                supabase.rpc("run_database_chores").execute()
                print("Initial database chores completed successfully.")

                # 2. Predict beyond each trajectory's latest real position and
                # persist those points with pred=True.
                if prediction_model is not None and prediction_scaler is not None:
                    predict_and_store_trajectories(prediction_model, prediction_scaler)
                else:
                    print("Skipping trajectory prediction because the model is unavailable.")

            except Exception as e:
                print(f"Error during trajectory prediction cycle: {e}")

            finally:
                # 3. Rebuild trajectories again so the table includes newly inserted
                # predicted positions. Run even if prediction raised an exception.
                try:
                    supabase.rpc("run_database_chores").execute()
                    print("Final database chores completed successfully.")
                except Exception as e:
                    print(f"Error running final database chores: {e}")

                last_db_chore_timestamp = time.time()

        # Fetch and process new ADS-B messages.
        print("Fetching raw messages...")
        messages = fetch_all_rows("raw_msg")
        client.handle_messages(messages)

        time.sleep(5)


if __name__ == "__main__":
    main()