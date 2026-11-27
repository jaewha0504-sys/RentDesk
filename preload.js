const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  load: () => ipcRenderer.invoke("load"),
  save: (text) => ipcRenderer.invoke("save", text),
  attach: (unitId, kind) => ipcRenderer.invoke("attach", { unitId, kind }),
  openFile: (p) => ipcRenderer.invoke("openFile", p),
  checkUpdates: () => ipcRenderer.invoke("checkUpdates"),
  appVersion: () => ipcRenderer.invoke("appVersion"),
  removeFile: (p) => ipcRenderer.invoke("removeFile", p),
  saveAttachmentCopy: (p) => ipcRenderer.invoke("saveAttachmentCopy", p),
  exportExcel: (bytes, name) => ipcRenderer.invoke("exportExcel", { bytes, name }),
  exportBackup: (text, name, attachPaths) => ipcRenderer.invoke("exportBackup", { text, name, attachPaths }),
  importBackup: () => ipcRenderer.invoke("importBackup"),

  // 여러 컴퓨터 동기화
  syncStatus: () => ipcRenderer.invoke("syncStatus"),
  syncCreate: (text) => ipcRenderer.invoke("syncCreate", text),
  syncJoin: (code, mode, text) => ipcRenderer.invoke("syncJoin", { code, mode, text }),
  syncUnpair: () => ipcRenderer.invoke("syncUnpair"),
  syncSetMode: (mode) => ipcRenderer.invoke("syncSetMode", mode),
  onSyncData: (fn) => ipcRenderer.on("sync:data", (_e, data) => fn(data)),
  onSyncStatus: (fn) => ipcRenderer.on("sync:status", (_e, s) => fn(s)),
});
