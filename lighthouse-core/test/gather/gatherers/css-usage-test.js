/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const CSSUsage = require('../../../gather/gatherers/css-usage.js');
const {defaultSettings} = require('../../../config/constants.js');
const {
  createMockDriver,
  createMockBaseArtifacts,
} = require('../../fraggle-rock/gather/mock-driver.js');
const {flushAllTimersAndMicrotasks} = require('../../test-utils.js');

jest.useFakeTimers();

describe('.getArtifact', () => {
  it('gets CSS usage', async () => {
    const driver = createMockDriver();
    driver.defaultSession.on
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '1'}})
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '2'}});
    driver.defaultSession.sendCommand
      .mockResponse('DOM.enable')
      // @ts-expect-error - Force events to emit.
      .mockResponse('CSS.enable', flushAllTimersAndMicrotasks)
      .mockResponse('CSS.startRuleUsageTracking')
      .mockResponse('CSS.getStyleSheetText', {text: 'CSS text 1'})
      .mockResponse('CSS.getStyleSheetText', {text: 'CSS text 2'})
      .mockResponse('CSS.stopRuleUsageTracking', {
        ruleUsage: [
          {styleSheetId: '1', used: true},
          {styleSheetId: '2', used: false},
        ],
      })
      .mockResponse('CSS.disable')
      .mockResponse('DOM.disable');

    /** @type {LH.Gatherer.FRTransitionalContext} */
    const context = {
      driver: driver.asDriver(),
      url: 'https://example.com',
      gatherMode: 'snapshot',
      computedCache: new Map(),
      baseArtifacts: createMockBaseArtifacts(),
      dependencies: {},
      settings: defaultSettings,
    };
    const gatherer = new CSSUsage();
    const artifact = await gatherer.getArtifact(context);

    expect(artifact).toEqual({
      stylesheets: [
        {
          header: {styleSheetId: '1'},
          content: 'CSS text 1',
        },
        {
          header: {styleSheetId: '2'},
          content: 'CSS text 2',
        },
      ],
      rules: [
        {
          styleSheetId: '1',
          used: true,
        },
        {
          styleSheetId: '2',
          used: false,
        },
      ],
    });
  });

  it('ignores removed stylesheets', async () => {
    const driver = createMockDriver();
    driver.defaultSession.on
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '1'}})
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '2'}})
      .mockEvent('CSS.styleSheetRemoved', {styleSheetId: '1'});
    driver.defaultSession.sendCommand
      .mockResponse('DOM.enable')
      .mockResponse('CSS.enable')
      .mockResponse('CSS.startRuleUsageTracking')
      .mockResponse('CSS.getStyleSheetText', () => {
        throw new Error('Sheet not found');
      })
      .mockResponse('CSS.getStyleSheetText', {text: 'CSS text 2'})
      .mockResponse('CSS.stopRuleUsageTracking', {
        ruleUsage: [
          {styleSheetId: '2', used: false},
        ],
      })
      .mockResponse('CSS.disable')
      .mockResponse('DOM.disable');

    /** @type {LH.Gatherer.FRTransitionalContext} */
    const context = {
      driver: driver.asDriver(),
      url: 'https://example.com',
      gatherMode: 'timespan',
      computedCache: new Map(),
      baseArtifacts: createMockBaseArtifacts(),
      dependencies: {},
      settings: defaultSettings,
    };

    const gatherer = new CSSUsage();
    await gatherer.startInstrumentation(context);

    // Force events to emit.
    await flushAllTimersAndMicrotasks(1);

    await gatherer.stopInstrumentation(context);
    const artifact = await gatherer.getArtifact(context);

    expect(artifact).toEqual({
      stylesheets: [
        {
          header: {styleSheetId: '2'},
          content: 'CSS text 2',
        },
      ],
      rules: [
        {
          styleSheetId: '2',
          used: false,
        },
      ],
    });
  });

  it('throws if it cannot get content of sheet', async () => {
    const driver = createMockDriver();
    driver.defaultSession.on
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '1'}})
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '2'}});
    driver.defaultSession.sendCommand
      .mockResponse('DOM.enable')
      .mockResponse('CSS.enable')
      .mockResponse('CSS.startRuleUsageTracking')
      .mockResponse('CSS.getStyleSheetText', () => {
        throw new Error('Sheet not found');
      })
      .mockResponse('CSS.getStyleSheetText', {text: 'CSS text 2'})
      .mockResponse('CSS.stopRuleUsageTracking', {
        ruleUsage: [
          {styleSheetId: '2', used: false},
        ],
      })
      .mockResponse('CSS.disable')
      .mockResponse('DOM.disable');

    /** @type {LH.Gatherer.FRTransitionalContext} */
    const context = {
      driver: driver.asDriver(),
      url: 'https://example.com',
      gatherMode: 'timespan',
      computedCache: new Map(),
      baseArtifacts: createMockBaseArtifacts(),
      dependencies: {},
      settings: defaultSettings,
    };

    const gatherer = new CSSUsage();
    await gatherer.startInstrumentation(context);

    // Force events to emit.
    await flushAllTimersAndMicrotasks(1);

    await gatherer.stopInstrumentation(context);
    const artifactPromise = gatherer.getArtifact(context);

    await expect(artifactPromise).rejects.toThrow('Sheet not found');
  });

  it('dedupes stylesheets', async () => {
    const driver = createMockDriver();
    driver.defaultSession.on
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '1'}})
      .mockEvent('CSS.styleSheetAdded', {header: {styleSheetId: '1'}});
    driver.defaultSession.sendCommand
      .mockResponse('DOM.enable')
      // @ts-expect-error - Force events to emit.
      .mockResponse('CSS.enable', flushAllTimersAndMicrotasks)
      .mockResponse('CSS.startRuleUsageTracking')
      .mockResponse('CSS.getStyleSheetText', {text: 'CSS text 1'})
      .mockResponse('CSS.getStyleSheetText', {text: 'CSS text 1'})
      .mockResponse('CSS.stopRuleUsageTracking', {
        ruleUsage: [
          {styleSheetId: '1', used: true},
        ],
      })
      .mockResponse('CSS.disable')
      .mockResponse('DOM.disable');

    /** @type {LH.Gatherer.FRTransitionalContext} */
    const context = {
      driver: driver.asDriver(),
      url: 'https://example.com',
      gatherMode: 'snapshot',
      computedCache: new Map(),
      baseArtifacts: createMockBaseArtifacts(),
      dependencies: {},
      settings: defaultSettings,
    };
    const gatherer = new CSSUsage();
    const artifact = await gatherer.getArtifact(context);

    expect(artifact).toEqual({
      stylesheets: [
        {
          header: {styleSheetId: '1'},
          content: 'CSS text 1',
        },
      ],
      rules: [
        {
          styleSheetId: '1',
          used: true,
        },
      ],
    });
  });
});
