import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

if (process.platform !== 'win32') {
  throw new Error('LightBridge native acceptance is supported on Windows only.');
}

const driverHost = '127.0.0.1';
const driverPort = 4444;
const appBinary = resolve('src-tauri/target/debug/lightbridge.exe');
const dataDirectory = join(tmpdir(), 'lightbridge-wdio');
const localDriverDirectory = resolve('.codex-local/msedgedriver');
let tauriDriver: ChildProcess | undefined;
let driverStartError: Error | undefined;

process.env.LIGHTBRIDGE_E2E = '1';
process.env.LIGHTBRIDGE_E2E_DATA_DIR = dataDirectory;
if (existsSync(join(localDriverDirectory, 'msedgedriver.exe'))) {
  process.env.PATH = `${localDriverDirectory}${delimiter}${process.env.PATH ?? ''}`;
}

function stopDriver() {
  tauriDriver?.kill();
  tauriDriver = undefined;
  driverStartError = undefined;
}

function isDriverListening(): Promise<boolean> {
  return new Promise((resolveReady) => {
    const socket = createConnection({ host: driverHost, port: driverPort });
    const finish = (ready: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolveReady(ready);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function waitForDriverReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (driverStartError != null) throw driverStartError;
    if (tauriDriver?.exitCode != null) {
      throw new Error(
        `tauri-driver exited before becoming ready (${tauriDriver.exitCode}).`,
      );
    }
    if (await isDriverListening()) return;
    await delay(50);
  }
  throw new Error('tauri-driver did not become ready on port 4444.');
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  host: driverHost,
  port: driverPort,
  specs: ['./e2e/specs/**/*.spec.ts'],
  maxInstances: 1,
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: appBinary,
      },
    },
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },
  onPrepare() {
    rmSync(dataDirectory, { recursive: true, force: true });
    const result = spawnSync(
      process.env.ComSpec ?? 'cmd.exe',
      [
        '/d',
        '/s',
        '/c',
        'pnpm exec tauri build --debug --no-bundle',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit',
      },
    );
    if (result.error != null) throw result.error;
    if (result.status !== 0) {
      throw new Error('Tauri debug build failed before WebDriver acceptance.');
    }
    if (!existsSync(appBinary)) {
      throw new Error('Tauri debug build completed without an app executable.');
    }
  },
  async beforeSession() {
    tauriDriver = spawn('tauri-driver.exe', [], {
      env: process.env,
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    tauriDriver.on('error', (error) => {
      driverStartError = error;
    });
    await waitForDriverReady();
  },
  afterSession() {
    stopDriver();
  },
  onComplete() {
    stopDriver();
  },
};
