const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adsbRescueCache", {
  read: () => ipcRenderer.invoke("plane-cache:read"),
  write: (serialized) => ipcRenderer.invoke("plane-cache:write", serialized),
});

contextBridge.exposeInMainWorld("adsbRescueData", {
  readPlanes: () => ipcRenderer.invoke("demo-data:read-planes"),
  readAirports: () => ipcRenderer.invoke("demo-data:read-airports"),
});
