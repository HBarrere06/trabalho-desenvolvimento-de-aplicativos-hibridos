const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
const fs = require("node:fs/promises");
const { app, BrowserWindow, ipcMain } = require("electron");

const appHtmlPath = path.resolve(__dirname, "..", "dist", "index.html");
const trustedRendererUrl = pathToFileURL(appHtmlPath).href;
const cachePath = path.join(app.getPath("userData"), "last-session.json");
const temporaryCachePath = `${cachePath}.tmp`;
const maximumCacheSize = 50 * 1024 * 1024;
const demoPlanesPath = path.resolve(__dirname, "..", "public", "response.json");
const airportsPath = path.resolve(__dirname, "..", "public", "airports.csv");

function assertTrustedRenderer(event) {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || fileURLToPath(senderUrl) !== appHtmlPath) {
    throw new Error("Acesso ao cache negado para este renderer.");
  }
}

ipcMain.handle("plane-cache:read", async (event) => {
  assertTrustedRenderer(event);
  try {
    return await fs.readFile(cachePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
});

ipcMain.handle("plane-cache:write", async (event, serialized) => {
  assertTrustedRenderer(event);
  if (
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > maximumCacheSize
  ) {
    throw new Error("O snapshot excede o limite de armazenamento da PoC.");
  }
  JSON.parse(serialized);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(temporaryCachePath, serialized, "utf8");
  await fs.rename(temporaryCachePath, cachePath);
});

ipcMain.handle("demo-data:read-planes", async (event) => {
  assertTrustedRenderer(event);
  return fs.readFile(demoPlanesPath, "utf8");
});

ipcMain.handle("demo-data:read-airports", async (event) => {
  assertTrustedRenderer(event);
  return fs.readFile(airportsPath, "utf8");
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, destination) => {
    if (destination !== trustedRendererUrl) event.preventDefault();
  });
  void window.loadFile(appHtmlPath);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
