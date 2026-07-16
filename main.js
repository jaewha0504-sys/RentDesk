const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

app.setName("RentDesk");

function dataDir() {
  const dir = app.getPath("userData"); // .../RentDesk
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function dataFile() { return path.join(dataDir(), "data.json"); }
function attachmentsDir() {
  const dir = path.join(dataDir(), "attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: "RentDesk",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// ---- 데이터 ----
ipcMain.handle("load", () => {
  try { return fs.readFileSync(dataFile(), "utf8"); }
  catch { return null; }
});
ipcMain.handle("save", (_e, text) => {
  fs.writeFileSync(dataFile(), text, "utf8");
  return true;
});

// ---- 첨부 ----
ipcMain.handle("attach", async (_e, { unitId, kind }) => {
  const res = await dialog.showOpenDialog({
    title: "파일 선택",
    properties: ["openFile"],
    filters: [{ name: "이미지·PDF", extensions: ["png", "jpg", "jpeg", "heic", "pdf", "gif", "webp"] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  const ext = path.extname(src) || ".dat";
  const dest = path.join(attachmentsDir(), `${unitId}_${kind}_${Date.now()}${ext}`);
  fs.copyFileSync(src, dest);
  return dest;
});
ipcMain.handle("openFile", (_e, p) => { if (p) shell.openPath(p); });
ipcMain.handle("removeFile", (_e, p) => { try { if (p) fs.unlinkSync(p); } catch {} });
ipcMain.handle("exportCsv", async (_e, { text, name }) => {
  const res = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, "﻿" + text, "utf8");
  return true;
});
ipcMain.handle("saveAttachmentCopy", async (_e, srcPath) => {
  const res = await dialog.showSaveDialog({ defaultPath: path.basename(srcPath) });
  if (res.canceled || !res.filePath) return false;
  fs.copyFileSync(srcPath, res.filePath);
  return true;
});

// ---- 백업 (다른 컴퓨터/OS로 이동) ----
ipcMain.handle("exportBackup", async (_e, { text, name }) => {
  const res = await dialog.showSaveDialog({ defaultPath: name, filters: [{ name: "RentDesk 백업", extensions: ["json"] }] });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, text, "utf8");   // BOM 없이 (JSON 호환)
  return true;
});
ipcMain.handle("importBackup", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "RentDesk 백업", extensions: ["json"] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  return fs.readFileSync(res.filePaths[0], "utf8");
});
