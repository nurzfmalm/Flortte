const { app, BrowserWindow, net, protocol, session } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_SCHEME = 'flortte';
const APP_HOST = 'app';
const DEVICE_NAME = 'FlortteGlove';
const APP_ROOT = path.resolve(__dirname, '..');

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function resolveAppFile(requestUrl) {
  const url = new URL(requestUrl);
  if (url.host !== APP_HOST) return null;

  const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = path.resolve(APP_ROOT, relativePath);
  const insideApp = filePath === APP_ROOT || filePath.startsWith(`${APP_ROOT}${path.sep}`);
  return insideApp ? filePath : null;
}

function allowBluetooth() {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'bluetooth';
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'bluetooth');
  });

  session.defaultSession.setDevicePermissionHandler((details) => {
    return details.deviceType === 'bluetooth';
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#f4f7ff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  let bluetoothCallback = null;

  window.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    bluetoothCallback = callback;

    const glove = devices.find((device) => device.deviceName === DEVICE_NAME);
    if (!glove) return;

    bluetoothCallback(glove.deviceId);
    bluetoothCallback = null;
  });

  window.on('closed', () => {
    if (bluetoothCallback) bluetoothCallback('');
    bluetoothCallback = null;
  });

  window.once('ready-to-show', () => window.show());
  window.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
}

app.whenReady().then(async () => {
  app.setAppUserModelId('kz.flortte.app');

  protocol.handle(APP_SCHEME, (request) => {
    const filePath = resolveAppFile(request.url);
    if (!filePath) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  allowBluetooth();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
