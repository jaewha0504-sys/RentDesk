const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  load: () => ipcRenderer.invoke("load"),
  save: (text) => ipcRenderer.invoke("save", text),
  attach: (unitId, kind) => ipcRenderer.invoke("attach", { unitId, kind }),
  openFile: (p) => ipcRenderer.invoke("openFile", p),
  removeFile: (p) => ipcRenderer.invoke("removeFile", p),
  exportCsv: (text, name) => ipcRenderer.invoke("exportCsv", { text, name }),
  saveAttachmentCopy: (p) => ipcRenderer.invoke("saveAttachmentCopy", p),
  exportBackup: (text, name) => ipcRenderer.invoke("exportBackup", { text, name }),
  importBackup: () => ipcRenderer.invoke("importBackup"),
});
