/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const {mockDriverSubmodules} = require('../../fraggle-rock/gather/mock-driver.js');
const mocks = mockDriverSubmodules();

const NetworkMonitor = require('../../../gather/driver/network-monitor.js');
const NetworkRequest = require('../../../lib/network-request.js');
const networkRecordsToDevtoolsLog = require('../../network-records-to-devtools-log.js');
const {createMockSendCommandFn: createMockSendCommandFn_} = require('../../test-utils.js');

/* eslint-env jest */

jest.useFakeTimers();

// This can be removed when FR becomes the default.
const createMockSendCommandFn = createMockSendCommandFn_.bind(null, {useSessionId: false});

const tscErr = new Error('Typecheck constrait failed');

describe('NetworkMonitor', () => {
  /** @type {ReturnType<typeof createMockSendCommandFn>} */
  let sendCommandMock;
  /** @type {LH.Gatherer.FRProtocolSession & {dispatch: (event: LH.Protocol.RawEventMessage | undefined) => void}} */
  let sessionMock;
  /** @type {Array<LH.Protocol.RawEventMessage>} */
  let devtoolsLog;
  /** @type {NetworkMonitor} */
  let monitor;
  /** @type {string[]} */
  let statusLog = [];

  function createMockSession() {
    /** @type {any} */
    const session = {};
    session.off = jest.fn();
    session.removeProtocolMessageListener = jest.fn();

    const on = (session.on = jest.fn());
    const addProtocolMessageListener = (session.addProtocolMessageListener = jest.fn());
    sendCommandMock = session.sendCommand = createMockSendCommandFn()
      .mockResponse('Page.enable')
      .mockResponse('Network.enable');
    /** @type {(event: LH.Protocol.RawEventMessage) => void} */
    session.dispatch = event => {
      const relevantOnListeners = on.mock.calls.filter(call => call[0] === event.method);
      for (const call of relevantOnListeners) {
        if (typeof call[1] === 'function') call[1](event.params);
      }

      for (const call of addProtocolMessageListener.mock.calls) {
        if (typeof call[0] === 'function') call[0](event);
      }
    };
    return session;
  }

  beforeEach(async () => {
    sessionMock = createMockSession();
    statusLog = [];
    monitor = new NetworkMonitor(sessionMock);
    monitor.on('networkbusy', () => statusLog.push('networkbusy'));
    monitor.on('networkidle', () => statusLog.push('networkidle'));
    monitor.on('network-2-busy', () => statusLog.push('network-2-busy'));
    monitor.on('network-2-idle', () => statusLog.push('network-2-idle'));
    monitor.on('network-critical-busy', () => statusLog.push('network-critical-busy'));
    monitor.on('network-critical-idle', () => statusLog.push('network-critical-idle'));

    mocks.targetManagerMock.enable.mockImplementation(async () => {
      for (const call of mocks.targetManagerMock.addTargetAttachedListener.mock.calls) {
        await call[0]({target: {type: 'page', targetId: 'page'}, session: sessionMock});
      }
    });

    const log = networkRecordsToDevtoolsLog([
      {url: 'http://example.com', priority: 'VeryHigh'},
      {url: 'http://example.com/xhr', priority: 'High'},
      {url: 'http://example.com/css', priority: 'VeryHigh'},
      {url: 'http://example.com/offscreen', priority: 'Low'},
    ]);

    const startEvents = log.filter(m => m.method === 'Network.requestWillBeSent');
    const restEvents = log.filter(m => !startEvents.includes(m));
    devtoolsLog = [...startEvents, ...restEvents];
  });

  afterEach(() => {
    mocks.targetManagerMock.reset();
  });

  describe('.enable() / .disable()', () => {
    it('should not record anything when disabled', async () => {
      for (const message of devtoolsLog) sessionMock.dispatch(message);
      expect(statusLog).toEqual([]);
    });

    it('should record once enabled', async () => {
      await monitor.enable();
      for (const message of devtoolsLog) sessionMock.dispatch(message);
      expect(sessionMock.on).toHaveBeenCalled();
      expect(sessionMock.addProtocolMessageListener).toHaveBeenCalled();
      expect(mocks.targetManagerMock.enable).toHaveBeenCalled();
      expect(statusLog.length).toBeGreaterThan(0);
    });

    it('should not record after enable/disable cycle', async () => {
      sendCommandMock.mockResponse('Network.disable');
      await monitor.enable();
      await monitor.disable();
      for (const message of devtoolsLog) sessionMock.dispatch(message);
      expect(sessionMock.on).toHaveBeenCalled();
      expect(sessionMock.off).toHaveBeenCalled();
      expect(sessionMock.addProtocolMessageListener).toHaveBeenCalled();
      expect(sessionMock.removeProtocolMessageListener).toHaveBeenCalled();
      expect(mocks.targetManagerMock.enable).toHaveBeenCalled();
      expect(mocks.targetManagerMock.disable).toHaveBeenCalled();
      expect(statusLog).toEqual([]);
    });

    it('should listen on every unique target', async () => {
      await monitor.enable();
      expect(mocks.targetManagerMock.addTargetAttachedListener).toHaveBeenCalledTimes(1);
      expect(mocks.targetManagerMock.enable).toHaveBeenCalledTimes(1);

      const targetListener = mocks.targetManagerMock.addTargetAttachedListener.mock.calls[0][0];
      expect(sessionMock.addProtocolMessageListener).toHaveBeenCalledTimes(1);
      expect(sendCommandMock).toHaveBeenCalledTimes(2);
      sendCommandMock
        .mockResponse('Network.enable')
        .mockResponse('Network.enable')
        .mockResponse('Network.enable');

      targetListener({target: {type: 'page', targetId: 'page-2'}, session: sessionMock}); // new
      expect(sessionMock.addProtocolMessageListener).toHaveBeenCalledTimes(2);
      expect(sendCommandMock).toHaveBeenCalledTimes(3);

      targetListener({target: {type: 'page', targetId: 'page-3'}, session: sessionMock}); // new
      expect(sessionMock.addProtocolMessageListener).toHaveBeenCalledTimes(3);
      expect(sendCommandMock).toHaveBeenCalledTimes(4);

      expect(sessionMock.removeProtocolMessageListener).toHaveBeenCalledTimes(0);
      await monitor.disable();
      expect(sessionMock.removeProtocolMessageListener).toHaveBeenCalledTimes(3);
    });

    it('should have idempotent enable', async () => {
      await monitor.enable();
      await monitor.enable();
      await monitor.enable();
      expect(sessionMock.on).toHaveBeenCalledTimes(1);
      expect(sessionMock.addProtocolMessageListener).toHaveBeenCalledTimes(1);
      expect(sendCommandMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('.getNavigationUrls()', () => {
    it('should handle the empty case', async () => {
      expect(await monitor.getNavigationUrls()).toEqual({});
    });

    it('should return the first and last navigation', async () => {
      sendCommandMock.mockResponse('Page.getResourceTree', {frameTree: {frame: {id: '1'}}});
      await monitor.enable();

      const type = 'Navigation';
      const frame = /** @type {*} */ ({id: '1', url: 'https://page.example.com'});
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame: {...frame, url: 'https://example.com'}, type}}); // eslint-disable-line max-len
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame: {...frame, url: 'https://intermediate.example.com'}, type}}); // eslint-disable-line max-len
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame, type}});

      expect(await monitor.getNavigationUrls()).toEqual({
        requestedUrl: 'https://example.com',
        mainDocumentUrl: 'https://page.example.com',
      });
    });

    it('should handle server redirects', async () => {
      sendCommandMock.mockResponse('Page.getResourceTree', {frameTree: {frame: {id: '1'}}});
      await monitor.enable();

      // One server redirect followed by a client redirect
      const devtoolsLog = networkRecordsToDevtoolsLog([
        {requestId: '1', startTime: 100, url: 'https://example.com', priority: 'VeryHigh'},
        {requestId: '1:redirect', startTime: 200, url: 'https://intermediate.example.com', priority: 'VeryHigh'},
        {requestId: '2', startTime: 300, url: 'https://page.example.com', priority: 'VeryHigh'},
      ]);
      for (const event of devtoolsLog) {
        sessionMock.dispatch(event);
      }

      const type = 'Navigation';
      const frame = /** @type {*} */ ({id: '1', url: 'https://page.example.com'});
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame: {...frame, url: 'https://intermediate.example.com'}, type}}); // eslint-disable-line max-len
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame, type}});

      expect(await monitor.getNavigationUrls()).toEqual({
        requestedUrl: 'https://example.com',
        mainDocumentUrl: 'https://page.example.com',
      });
    });

    it('should ignore non-main-frame navigations', async () => {
      sendCommandMock.mockResponse('Page.getResourceTree', {frameTree: {frame: {id: '1'}}});
      await monitor.enable();

      const type = 'Navigation';
      const frame = /** @type {*} */ ({id: '1', url: 'https://page.example.com'});
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame, type}});
      const iframe = /** @type {*} */ ({id: '2', url: 'https://iframe.example.com'});
      sessionMock.dispatch({method: 'Page.frameNavigated', params: {frame: iframe, type}});

      expect(await monitor.getNavigationUrls()).toEqual({
        requestedUrl: 'https://page.example.com',
        mainDocumentUrl: 'https://page.example.com',
      });
    });
  });

  describe('EventEmitter', () => {
    it('should reemit the requeststarted / requestloaded events', async () => {
      await monitor.enable();
      /** @type {Array<string>} */
      const startedLog = [];
      /** @type {Array<string>} */
      const loadedLog = [];
      monitor.on('requeststarted', /** @param {*} r */ r => startedLog.push(r));
      monitor.on('requestloaded', /** @param {*} r */ r => loadedLog.push(r));
      for (const message of devtoolsLog) sessionMock.dispatch(message);
      expect(startedLog).toHaveLength(4);
      expect(loadedLog).toHaveLength(4);
    });

    it('should emit the cycle of network status events', async () => {
      await monitor.enable();
      for (const message of devtoolsLog) sessionMock.dispatch(message);

      expect(statusLog).toEqual([
        // First request starts.
        'networkbusy',
        'network-2-idle',
        'network-critical-busy',
        // Second request starts.
        'networkbusy',
        'network-2-idle',
        'network-critical-busy',
        // Third request starts.
        'networkbusy',
        'network-2-busy',
        'network-critical-busy',
        // Fourth request starts.
        'networkbusy',
        'network-2-busy',
        'network-critical-busy',
        // First request finishes.
        'networkbusy',
        'network-2-busy',
        'network-critical-busy',
        // Second request finishes.
        'networkbusy',
        'network-2-idle',
        'network-critical-busy',
        // Third request finishes (leaving 1 Low-pri).
        'networkbusy',
        'network-2-idle',
        'network-critical-idle',
        // Fourth request finishes.
        'networkidle',
        'network-2-idle',
        'network-critical-idle',
      ]);
    });
  });

  describe('.isIdle() methods', () => {
    beforeEach(async () => {
      await monitor.enable();
    });

    it('should capture quiet state in getters', () => {
      expect(monitor.isIdle()).toBe(true);
      expect(monitor.is2Idle()).toBe(true);
      expect(monitor.isCriticalIdle()).toBe(true);
    });

    it('should capture single high-pri request state in getters', () => {
      const startMessage = devtoolsLog.find(event => event.method === 'Network.requestWillBeSent');
      sessionMock.dispatch(startMessage);
      expect(monitor.isIdle()).toBe(false);
      expect(monitor.is2Idle()).toBe(true);
      expect(monitor.isCriticalIdle()).toBe(false);
    });

    it('should not consider cross frame requests critical', () => {
      for (const message of devtoolsLog) sessionMock.dispatch(message);
      expect(monitor.isIdle()).toBe(true);
      expect(monitor.is2Idle()).toBe(true);
      expect(monitor.isCriticalIdle()).toBe(true);

      const crossFrameLog = networkRecordsToDevtoolsLog([
        {requestId: '5', url: 'http://3p.example.com', priority: 'VeryHigh', frameId: 'OOPIF'},
      ]);
      const startMessage = crossFrameLog.find(e => e.method === 'Network.requestWillBeSent');
      sessionMock.dispatch(startMessage);

      expect(monitor.isIdle()).toBe(false);
      expect(monitor.is2Idle()).toBe(true);
      expect(monitor.isCriticalIdle()).toBe(true);
    });

    it('should capture single low-pri request state in getters', () => {
      const startMessage = devtoolsLog.find(event => event.method === 'Network.requestWillBeSent');
      if (!startMessage || startMessage.method !== 'Network.requestWillBeSent') throw tscErr;
      startMessage.params.request.initialPriority = 'Low';
      sessionMock.dispatch(startMessage);
      expect(monitor.isIdle()).toBe(false);
      expect(monitor.is2Idle()).toBe(true);
      expect(monitor.isCriticalIdle()).toBe(true);
    });

    it('should capture multiple request state in getters', () => {
      const messages = devtoolsLog.filter(event => event.method === 'Network.requestWillBeSent');
      for (const message of messages) sessionMock.dispatch(message);
      expect(monitor.isIdle()).toBe(false);
      expect(monitor.is2Idle()).toBe(false);
      expect(monitor.isCriticalIdle()).toBe(false);
    });

    it('should capture multiple low-pri request state in getters', () => {
      const messages = devtoolsLog.filter(event => event.method === 'Network.requestWillBeSent');
      for (const message of messages) {
        if (message.method !== 'Network.requestWillBeSent') throw tscErr;
        message.params.request.initialPriority = 'Low';
        sessionMock.dispatch(message);
      }

      expect(monitor.isIdle()).toBe(false);
      expect(monitor.is2Idle()).toBe(false);
      expect(monitor.isCriticalIdle()).toBe(true);
    });
  });

  describe('#findNetworkQuietPeriods', () => {
    /**
     * @param {Partial<NetworkRequest>} data
     * @return {NetworkRequest}
     */
    function record(data) {
      const url = data.url || 'https://example.com';
      const scheme = url.split(':')[0];
      return Object.assign(
        new NetworkRequest(),
        {
          url,
          finished: !!data.endTime,
          parsedURL: {scheme},
        },
        data
      );
    }

    it('should find the 0-quiet periods', () => {
      const records = [
        record({startTime: 0, endTime: 1}),
        record({startTime: 2, endTime: 3}),
        record({startTime: 4, endTime: 5}),
      ];

      const periods = NetworkMonitor.findNetworkQuietPeriods(records, 0);
      expect(periods).toEqual([
        {start: 1000, end: 2000},
        {start: 3000, end: 4000},
        {start: 5000, end: Infinity},
      ]);
    });

    it('should find the 2-quiet periods', () => {
      const records = [
        record({startTime: 0, endTime: 1.5}),
        record({startTime: 0, endTime: 2}),
        record({startTime: 0, endTime: 2.5}),
        record({startTime: 2, endTime: 3}),
        record({startTime: 4, endTime: 5}),
      ];

      const periods = NetworkMonitor.findNetworkQuietPeriods(records, 2);
      expect(periods).toEqual([{start: 1500, end: Infinity}]);
    });

    it('should handle unfinished requests', () => {
      const records = [
        record({startTime: 0, endTime: 1.5}),
        record({startTime: 0, endTime: 2}),
        record({startTime: 0, endTime: 2.5}),
        record({startTime: 2, endTime: 3}),
        record({startTime: 2}),
        record({startTime: 2}),
        record({startTime: 4, endTime: 5}),
        record({startTime: 5.5}),
      ];

      const periods = NetworkMonitor.findNetworkQuietPeriods(records, 2);
      expect(periods).toEqual([
        {start: 1500, end: 2000},
        {start: 3000, end: 4000},
        {start: 5000, end: 5500},
      ]);
    });

    it('should ignore data URIs', () => {
      const records = [
        record({startTime: 0, endTime: 1}),
        record({startTime: 0, endTime: 2, url: 'data:image/png;base64,', protocol: 'data'}),
      ];

      const periods = NetworkMonitor.findNetworkQuietPeriods(records, 0);
      expect(periods).toEqual([{start: 1000, end: Infinity}]);
    });

    it('should handle iframe requests', () => {
      const iframeRequest = {
        finished: false,
        url: 'https://iframe.com',
        documentURL: 'https://iframe.com',
        responseReceivedTime: 1.2,
      };

      const records = [
        record({startTime: 0, endTime: 1}),
        record({startTime: 0, endTime: 1.2, ...iframeRequest}),
      ];

      const periods = NetworkMonitor.findNetworkQuietPeriods(records, 0);
      expect(periods).toEqual([]);
    });

    it('should handle QUIC requests', () => {
      /** @type {Partial<NetworkRequest>} */
      const quicRequest = {
        finished: false,
        responseHeaders: [{name: 'ALT-SVC', value: 'hq=":49288";quic="1,1abadaba,51303334,0"'}],
        timing: /** @type {*} */ ({receiveHeadersEnd: 1.28}),
      };

      const records = [
        record({startTime: 0, endTime: 1}),
        record({startTime: 0, endTime: 2, ...quicRequest}),
      ];

      const periods = NetworkMonitor.findNetworkQuietPeriods(records, 0);
      expect(periods).toEqual([]);
    });
  });
});
