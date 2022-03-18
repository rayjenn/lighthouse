/**
 * @license Copyright 2018 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

jest.mock('@sentry/node');

const sentryNode = require('@sentry/node');
const Sentry = require('../../lib/sentry.js');

/* eslint-env jest */

describe('Sentry', () => {
  let configPayload;
  let originalSentry;

  beforeEach(() => {
    configPayload = {
      url: 'http://example.com',
      flags: {enableErrorReporting: true},
      environmentData: {},
    };

    // We need to save the Sentry delegate object because every call to `.init` mutates the methods.
    // We want to have a fresh state for every test.
    originalSentry = {...Sentry};

    sentryNode.init = jest.fn().mockReturnValue({install: jest.fn()});
    sentryNode.setExtras = jest.fn();
    sentryNode.captureException = jest.fn();
    sentryNode.withScope = (fn) => fn({
      setLevel: () => {},
      setTags: () => {},
      setExtras: () => {},
    });
    Sentry._shouldSample = jest.fn().mockReturnValue(true);
  });

  afterEach(() => {
    // Reset the methods on the Sentry object, see note above.
    Object.assign(Sentry, originalSentry);
  });

  describe('.init', () => {
    it('should noop when !enableErrorReporting', () => {
      Sentry.init({url: 'http://example.com', flags: {}});
      expect(sentryNode.init).not.toHaveBeenCalled();
      Sentry.init({url: 'http://example.com', flags: {enableErrorReporting: false}});
      expect(sentryNode.init).not.toHaveBeenCalled();
    });

    it('should noop when not picked for sampling', () => {
      Sentry._shouldSample.mockReturnValue(false);
      Sentry.init({url: 'http://example.com', flags: {enableErrorReporting: true}});
      expect(sentryNode.init).not.toHaveBeenCalled();
    });

    it('should initialize the Sentry client when enableErrorReporting', () => {
      Sentry.init({
        url: 'http://example.com',
        flags: {
          enableErrorReporting: true,
          formFactor: 'desktop',
          throttlingMethod: 'devtools',
        },
        environmentData: {},
      });

      expect(sentryNode.init).toHaveBeenCalled();
      expect(sentryNode.setExtras).toHaveBeenCalled();
      expect(sentryNode.setExtras.mock.calls[0][0]).toEqual({
        channel: 'cli',
        url: 'http://example.com',
        formFactor: 'desktop',
        throttlingMethod: 'devtools',
      });
    });
  });

  describe('.captureException', () => {
    it('should forward exceptions to Sentry client', async () => {
      Sentry.init(configPayload);
      const error = new Error('oops');
      await Sentry.captureException(error);

      expect(sentryNode.captureException).toHaveBeenCalled();
      expect(sentryNode.captureException.mock.calls[0][0]).toBe(error);
    });

    it('should skip expected errors', async () => {
      Sentry.init(configPayload);
      const error = new Error('oops');
      error.expected = true;
      await Sentry.captureException(error);

      expect(sentryNode.captureException).not.toHaveBeenCalled();
    });

    it('should skip duplicate audit errors', async () => {
      Sentry.init(configPayload);
      const error = new Error('A');
      await Sentry.captureException(error, {tags: {audit: 'my-audit'}});
      await Sentry.captureException(error, {tags: {audit: 'my-audit'}});

      expect(sentryNode.captureException).toHaveBeenCalledTimes(1);
    });

    it('should still allow different audit errors', async () => {
      Sentry.init(configPayload);
      const errorA = new Error('A');
      const errorB = new Error('B');
      await Sentry.captureException(errorA, {tags: {audit: 'my-audit'}});
      await Sentry.captureException(errorB, {tags: {audit: 'my-audit'}});

      expect(sentryNode.captureException).toHaveBeenCalledTimes(2);
    });

    it('should skip duplicate gatherer errors', async () => {
      Sentry.init(configPayload);
      const error = new Error('A');
      await Sentry.captureException(error, {tags: {gatherer: 'my-gatherer'}});
      await Sentry.captureException(error, {tags: {gatherer: 'my-gatherer'}});

      expect(sentryNode.captureException).toHaveBeenCalledTimes(1);
    });
  });
});
