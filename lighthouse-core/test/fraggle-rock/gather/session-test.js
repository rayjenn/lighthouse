/**
 * @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const {EventEmitter} = require('events');
const ProtocolSession = require('../../../fraggle-rock/gather/session.js');
const {
  flushAllTimersAndMicrotasks,
  makePromiseInspectable,
  createDecomposedPromise,
} = require('../../test-utils.js');

/* eslint-env jest */

jest.useFakeTimers();

describe('ProtocolSession', () => {
  const DEFAULT_TIMEOUT = 30_000;

  /** @type {LH.Puppeteer.CDPSession} */
  let puppeteerSession;
  /** @type {ProtocolSession} */
  let session;

  beforeEach(() => {
    // @ts-expect-error - Individual mock functions are applied as necessary.
    puppeteerSession = {emit: jest.fn(), send: jest.fn().mockResolvedValue()};
    session = new ProtocolSession(puppeteerSession);
  });

  describe('ProtocolSession', () => {
    it('should emit a copy of events on "*"', () => {
      // @ts-expect-error - we want to use a more limited test of a real event emitter.
      puppeteerSession = new EventEmitter();
      session = new ProtocolSession(puppeteerSession);

      const regularListener = jest.fn();
      const allListener = jest.fn();

      puppeteerSession.on('Foo', regularListener);
      puppeteerSession.on('*', allListener);
      puppeteerSession.emit('Foo', 1);
      puppeteerSession.emit('Bar', 1);

      expect(regularListener).toHaveBeenCalledTimes(1);
      expect(allListener).toHaveBeenCalledTimes(2);
      expect(allListener).toHaveBeenCalledWith({method: 'Foo', params: 1});
      expect(allListener).toHaveBeenCalledWith({method: 'Bar', params: 1});
    });

    it('should not fire duplicate events', () => {
      // @ts-expect-error - we want to use a more limited test of a real event emitter.
      puppeteerSession = new EventEmitter();
      session = new ProtocolSession(puppeteerSession);
      session = new ProtocolSession(puppeteerSession);

      const regularListener = jest.fn();
      const allListener = jest.fn();

      puppeteerSession.on('Foo', regularListener);
      puppeteerSession.on('*', allListener);
      puppeteerSession.emit('Foo', 1);
      puppeteerSession.emit('Bar', 1);

      expect(regularListener).toHaveBeenCalledTimes(1);
      expect(allListener).toHaveBeenCalledTimes(2);
    });

    it('should include sessionId for iframes', () => {
      // @ts-expect-error - we want to use a more limited test of a real event emitter.
      puppeteerSession = new EventEmitter();
      session = new ProtocolSession(puppeteerSession);

      const listener = jest.fn();
      const targetInfo = {title: '', url: '', attached: true, canAccessOpener: false};

      puppeteerSession.on('*', listener);
      session.setTargetInfo({targetId: 'page', type: 'page', ...targetInfo});
      puppeteerSession.emit('Foo', 1);
      session.setTargetInfo({targetId: 'iframe', type: 'iframe', ...targetInfo});
      puppeteerSession.emit('Bar', 1);

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith({method: 'Foo', params: 1});
      expect(listener).toHaveBeenCalledWith({method: 'Bar', params: 1, sessionId: 'iframe'});
    });
  });

  /** @type {Array<'on'|'off'|'once'>} */
  const delegateMethods = ['on', 'once', 'off'];
  for (const method of delegateMethods) {
    describe(`.${method}`, () => {
      it('delegates to puppeteer', async () => {
        const puppeteerFn = puppeteerSession[method] = jest.fn();
        const callback = () => undefined;

        session[method]('Page.frameNavigated', callback);
        expect(puppeteerFn).toHaveBeenCalledWith('Page.frameNavigated', callback);
      });
    });
  }

  describe('.dispose', () => {
    it('should detach from the session', async () => {
      const detach = jest.fn();
      const removeAllListeners = jest.fn();
      // @ts-expect-error - we want to use a more limited test.
      puppeteerSession = {detach, emit: jest.fn(), removeAllListeners};
      session = new ProtocolSession(puppeteerSession);

      await session.dispose();
      expect(detach).toHaveBeenCalled();
      expect(removeAllListeners).toHaveBeenCalled();
    });
  });

  describe('.addProtocolMessageListener', () => {
    it('should listen for any event', () => {
      // @ts-expect-error - we want to use a more limited test of a real event emitter.
      puppeteerSession = new EventEmitter();
      session = new ProtocolSession(puppeteerSession);

      const regularListener = jest.fn();
      const allListener = jest.fn();

      session.on('Page.frameNavigated', regularListener);
      session.addProtocolMessageListener(allListener);

      puppeteerSession.emit('Page.frameNavigated');
      puppeteerSession.emit('Debugger.scriptParsed', {script: 'details'});

      expect(regularListener).toHaveBeenCalledTimes(1);
      expect(regularListener).toHaveBeenCalledWith();
      expect(allListener).toHaveBeenCalledTimes(2);
      expect(allListener).toHaveBeenCalledWith({method: 'Page.frameNavigated', params: undefined});
      expect(allListener).toHaveBeenCalledWith({
        method: 'Debugger.scriptParsed',
        params: {script: 'details'},
      });
    });
  });

  describe('.removeProtocolMessageListener', () => {
    it('should stop listening for any event', () => {
      // @ts-expect-error - we want to use a more limited test of a real event emitter.
      puppeteerSession = new EventEmitter();
      session = new ProtocolSession(puppeteerSession);

      const allListener = jest.fn();

      session.addProtocolMessageListener(allListener);
      puppeteerSession.emit('Page.frameNavigated');
      expect(allListener).toHaveBeenCalled();
      session.removeProtocolMessageListener(allListener);
      puppeteerSession.emit('Page.frameNavigated');
      expect(allListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('.addSessionAttachedListener', () => {
    it('should listen for new sessions', () => {
      const mockOn = jest.fn();
      // @ts-expect-error - we want to use a more limited, controllable test
      puppeteerSession = {connection: () => ({on: mockOn}), emit: jest.fn()};
      session = new ProtocolSession(puppeteerSession);

      // Make sure we listen for the event.
      const listener = jest.fn();
      session.addSessionAttachedListener(listener);
      expect(mockOn).toHaveBeenCalledWith('sessionattached', expect.any(Function));

      // Make sure we wrap the return in a ProtocolSession.
      mockOn.mock.calls[0][1]({emit: jest.fn()});
      expect(listener).toHaveBeenCalledWith(expect.any(ProtocolSession));
    });
  });

  describe('.removeSessionAttachedListener', () => {
    it('should stop listening for new sessions', () => {
      const mockOn = jest.fn();
      const mockOff = jest.fn();
      // @ts-expect-error - we want to use a more limited, controllable test
      puppeteerSession = {connection: () => ({on: mockOn, off: mockOff}), emit: jest.fn()};
      session = new ProtocolSession(puppeteerSession);

      // Make sure we listen for the event.
      const userListener = jest.fn();
      session.addSessionAttachedListener(userListener);
      expect(mockOn).toHaveBeenCalledWith('sessionattached', expect.any(Function));

      // Make sure we unlisten the mapped function, not just the user's listener.
      const installedListener = mockOn.mock.calls[0][1];
      session.removeSessionAttachedListener(userListener);
      expect(mockOff).toHaveBeenCalledWith('sessionattached', installedListener);
    });
  });

  describe('.sendCommand', () => {
    it('delegates to puppeteer', async () => {
      const send = puppeteerSession.send = jest.fn().mockResolvedValue(123);

      const result = await session.sendCommand('Page.navigate', {url: 'foo'});
      expect(result).toEqual(123);
      expect(send).toHaveBeenCalledWith('Page.navigate', {url: 'foo'});
    });

    it('times out a request by default', async () => {
      const sendPromise = createDecomposedPromise();
      puppeteerSession.send = jest.fn().mockReturnValue(sendPromise.promise);

      const resultPromise = makePromiseInspectable(session.sendCommand('Page.navigate', {url: ''}));

      await jest.advanceTimersByTime(DEFAULT_TIMEOUT + 1);
      await flushAllTimersAndMicrotasks();

      expect(resultPromise).toBeDone();
      await expect(resultPromise).rejects.toMatchObject({
        code: 'PROTOCOL_TIMEOUT',
        protocolMethod: 'Page.navigate',
      });
    });

    it('times out a request with explicit timeout', async () => {
      const sendPromise = createDecomposedPromise();
      puppeteerSession.send = jest.fn().mockReturnValue(sendPromise.promise);

      session.setNextProtocolTimeout(60_000);
      const resultPromise = makePromiseInspectable(session.sendCommand('Page.navigate', {url: ''}));

      await jest.advanceTimersByTime(DEFAULT_TIMEOUT + 1);
      await flushAllTimersAndMicrotasks();

      expect(resultPromise).not.toBeDone();

      await jest.advanceTimersByTime(DEFAULT_TIMEOUT + 1);
      await flushAllTimersAndMicrotasks();

      expect(resultPromise).toBeDone();
      await expect(resultPromise).rejects.toMatchObject({
        code: 'PROTOCOL_TIMEOUT',
        protocolMethod: 'Page.navigate',
      });
    });

    it('respects a timeout of infinity', async () => {
      const sendPromise = createDecomposedPromise();
      puppeteerSession.send = jest.fn().mockReturnValue(sendPromise.promise);

      session.setNextProtocolTimeout(Infinity);
      const resultPromise = makePromiseInspectable(session.sendCommand('Page.navigate', {url: ''}));

      await jest.advanceTimersByTime(100_000);
      await flushAllTimersAndMicrotasks();

      expect(resultPromise).not.toBeDone();

      sendPromise.resolve('result');
      await flushAllTimersAndMicrotasks();

      expect(resultPromise).toBeDone();
      expect(await resultPromise).toBe('result');
    });
  });

  describe('.has/get/setNextProtocolTimeout', () => {
    it('should handle when none has been set', () => {
      expect(session.hasNextProtocolTimeout()).toBe(false);
      expect(session.getNextProtocolTimeout()).toBe(DEFAULT_TIMEOUT);
    });

    it('should handle when one has been set', () => {
      session.setNextProtocolTimeout(5_000);
      expect(session.hasNextProtocolTimeout()).toBe(true);
      expect(session.getNextProtocolTimeout()).toBe(5_000);
    });

    it('should handle when default has been explicitly set', () => {
      session.setNextProtocolTimeout(DEFAULT_TIMEOUT);
      expect(session.hasNextProtocolTimeout()).toBe(true);
      expect(session.getNextProtocolTimeout()).toBe(DEFAULT_TIMEOUT);
    });

    it('should handle result after a command', () => {
      session.setNextProtocolTimeout(10_000);
      expect(session.hasNextProtocolTimeout()).toBe(true);
      expect(session.getNextProtocolTimeout()).toBe(10_000);

      session.sendCommand('Page.navigate', {url: ''});

      expect(session.hasNextProtocolTimeout()).toBe(false);
      expect(session.getNextProtocolTimeout()).toBe(DEFAULT_TIMEOUT);
    });
  });
});
