/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const {
  createMockOnFn,
  createMockOnceFn,
  createMockSendCommandFn,
} = require('../../gather/mock-commands.js');
const {defaultSettings} = require('../../../config/constants.js');

/**
 * @fileoverview Mock fraggle rock driver for testing.
 */

/** @typedef {import('../../../fraggle-rock/gather/driver.js')} Driver */
/** @typedef {import('../../../gather/driver/execution-context.js')} ExecutionContext */

function createMockSession() {
  return {
    setTargetInfo: jest.fn(),
    sendCommand: createMockSendCommandFn({useSessionId: false}),
    setNextProtocolTimeout: jest.fn(),
    once: createMockOnceFn(),
    on: createMockOnFn(),
    off: jest.fn(),
    addProtocolMessageListener: createMockOnFn(),
    removeProtocolMessageListener: jest.fn(),
    addSessionAttachedListener: createMockOnFn(),
    removeSessionAttachedListener: jest.fn(),
    dispose: jest.fn(),

    /** @return {LH.Gatherer.FRProtocolSession} */
    asSession() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

/**
 * @param {LH.Gatherer.AnyFRGathererInstance['meta']} meta
 */
function createMockGathererInstance(meta) {
  return {
    meta,
    startInstrumentation: jest.fn(),
    stopInstrumentation: jest.fn(),
    startSensitiveInstrumentation: jest.fn(),
    stopSensitiveInstrumentation: jest.fn(),
    getArtifact: jest.fn(),

    /** @return {LH.Gatherer.AnyFRGathererInstance} */
    asGatherer() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockPage() {
  return {
    url: jest.fn().mockReturnValue('https://example.com'),
    goto: jest.fn(),
    target: () => ({createCDPSession: () => createMockSession()}),

    /** @return {import('puppeteer').Page} */
    asPage() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockExecutionContext() {
  return {
    evaluate: jest.fn(),
    evaluateAsync: jest.fn(),
    evaluateOnNewDocument: jest.fn(),
    cacheNativesOnNewDocument: jest.fn(),

    /** @return {ExecutionContext} */
    asExecutionContext() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockTargetManager() {
  return {
    enable: jest.fn(),
    disable: jest.fn(),
    addTargetAttachedListener: createMockOnFn(),
    removeTargetAttachedListener: jest.fn(),
    /** @param {LH.Gatherer.FRProtocolSession} session */
    mockEnable(session) {
      this.enable.mockImplementation(async () => {
        const listeners = this.addTargetAttachedListener.mock.calls.map(call => call[0]);
        const targetWithSession = {target: {type: 'page', targetId: 'page'}, session};
        for (const listener of listeners) await listener(targetWithSession);
      });
    },
    reset() {
      this.enable = jest.fn();
      this.disable = jest.fn();
      this.addTargetAttachedListener = createMockOnFn();
      this.removeTargetAttachedListener = jest.fn();
    },
    /** @return {import('../../../gather/driver/target-manager.js')} */
    asTargetManager() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function createMockDriver() {
  const page = createMockPage();
  const session = createMockSession();
  const context = createMockExecutionContext();

  return {
    _page: page,
    _executionContext: context,
    _session: session,
    url: jest.fn(() => page.url()),
    defaultSession: session,
    connect: jest.fn(),
    disconnect: jest.fn(),
    executionContext: context.asExecutionContext(),

    /** @return {Driver} */
    asDriver() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function mockRunnerModule() {
  const runnerModule = {
    getAuditList: jest.fn().mockReturnValue([]),
    getGathererList: jest.fn().mockReturnValue([]),
    audit: jest.fn(),
    gather: jest.fn(),
    reset,
  };

  jest.mock('../../../runner.js', () => runnerModule);

  function reset() {
    runnerModule.getGathererList.mockReturnValue([]);
    runnerModule.getAuditList.mockReturnValue([]);
    runnerModule.audit.mockReset();
    runnerModule.gather.mockReset();
  }

  return runnerModule;
}

/** @param {() => Driver} driverProvider */
function mockDriverModule(driverProvider) {
  // This must be a regular function becaues Driver is always invoked as a constructor.
  // Arrow functions cannot be invoked with `new`.
  return function() {
    return driverProvider();
  };
}

/**
 * @returns {LH.FRBaseArtifacts}
 */
function createMockBaseArtifacts() {
  return {
    fetchTime: new Date().toISOString(),
    URL: {finalUrl: 'https://example.com', requestedUrl: 'https://example.com'},
    PageLoadError: null,
    settings: defaultSettings,
    BenchmarkIndex: 500,
    LighthouseRunWarnings: [],
    Timing: [],
    HostFormFactor: 'desktop',
    HostUserAgent: 'Chrome/93.0.1449.0',
    GatherContext: {gatherMode: 'navigation'},
  };
}

function mockTargetManagerModule() {
  const targetManagerMock = createMockTargetManager();

  /** @type {(instance: any) => (...args: any[]) => any} */
  const proxyCtor = instance => function() {
    // IMPORTANT! This must be a `function` not an arrow function so it can be invoked as a constructor.
    return instance;
  };

  jest.mock('../../../gather/driver/target-manager.js', () => proxyCtor(targetManagerMock));

  return targetManagerMock;
}

function createMockContext() {
  return {
    driver: createMockDriver(),
    url: 'https://example.com',
    gatherMode: 'navigation',
    computedCache: new Map(),
    dependencies: {},
    baseArtifacts: createMockBaseArtifacts(),
    settings: defaultSettings,

    /** @return {LH.Gatherer.FRTransitionalContext} */
    asContext() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },

    /** @return {LH.Gatherer.PassContext} */
    asLegacyContext() {
      // @ts-expect-error - We'll rely on the tests passing to know this matches.
      return this;
    },
  };
}

function mockDriverSubmodules() {
  const navigationMock = {gotoURL: jest.fn()};
  const prepareMock = {
    prepareThrottlingAndNetwork: jest.fn(),
    prepareTargetForTimespanMode: jest.fn(),
    prepareTargetForNavigationMode: jest.fn(),
    prepareTargetForIndividualNavigation: jest.fn(),
  };
  const storageMock = {clearDataForOrigin: jest.fn()};
  const emulationMock = {
    clearThrottling: jest.fn(),
    emulate: jest.fn(),
  };
  const networkMock = {
    fetchResponseBodyFromCache: jest.fn(),
  };
  const targetManagerMock = mockTargetManagerModule();

  function reset() {
    navigationMock.gotoURL = jest.fn().mockResolvedValue({finalUrl: 'https://example.com', warnings: [], timedOut: false});
    prepareMock.prepareThrottlingAndNetwork = jest.fn().mockResolvedValue(undefined);
    prepareMock.prepareTargetForTimespanMode = jest.fn().mockResolvedValue(undefined);
    prepareMock.prepareTargetForNavigationMode = jest.fn().mockResolvedValue({warnings: []});
    prepareMock.prepareTargetForIndividualNavigation = jest.fn().mockResolvedValue({warnings: []});
    storageMock.clearDataForOrigin = jest.fn();
    emulationMock.clearThrottling = jest.fn();
    emulationMock.emulate = jest.fn();
    networkMock.fetchResponseBodyFromCache = jest.fn().mockResolvedValue('');
    targetManagerMock.reset();
  }

  /**
   * @param {Record<string, (...args: any[]) => any>} target
   * @param {string} name
   * @return {(...args: any[]) => void}
   */
  const get = (target, name) => {
    if (!target[name]) throw new Error(`Target does not have property "${name}"`);
    return (...args) => target[name](...args);
  };

  jest.mock('../../../gather/driver/navigation.js', () => new Proxy(navigationMock, {get}));
  jest.mock('../../../gather/driver/prepare.js', () => new Proxy(prepareMock, {get}));
  jest.mock('../../../gather/driver/storage.js', () => new Proxy(storageMock, {get}));
  jest.mock('../../../gather/driver/network.js', () => new Proxy(networkMock, {get}));
  jest.mock('../../../lib/emulation.js', () => new Proxy(emulationMock, {get}));

  reset();

  return {
    navigationMock,
    prepareMock,
    storageMock,
    emulationMock,
    networkMock,
    targetManagerMock,
    reset,
  };
}

module.exports = {
  mockRunnerModule,
  mockTargetManagerModule,
  mockDriverModule,
  mockDriverSubmodules,
  createMockDriver,
  createMockPage,
  createMockSession,
  createMockGathererInstance,
  createMockBaseArtifacts,
  createMockContext,
};
