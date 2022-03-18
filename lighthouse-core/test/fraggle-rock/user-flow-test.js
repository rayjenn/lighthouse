/**
 * @license Copyright 2021 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

/* eslint-env jest */

const {createMockPage, mockRunnerModule} = require('./gather/mock-driver.js');

const snapshotModule = {snapshotGather: jest.fn()};
jest.mock('../../fraggle-rock/gather/snapshot-runner.js', () => snapshotModule);
const navigationModule = {navigationGather: jest.fn()};
jest.mock('../../fraggle-rock/gather/navigation-runner.js', () => navigationModule);
const timespanModule = {startTimespanGather: jest.fn()};
jest.mock('../../fraggle-rock/gather/timespan-runner.js', () => timespanModule);

const mockRunner = mockRunnerModule();

const {UserFlow, auditGatherSteps} = require('../../fraggle-rock/user-flow.js');

describe('UserFlow', () => {
  let mockPage = createMockPage();

  beforeEach(() => {
    mockPage = createMockPage();

    mockRunner.reset();

    snapshotModule.snapshotGather.mockReset();
    snapshotModule.snapshotGather.mockResolvedValue({
      artifacts: {
        URL: {finalUrl: 'https://www.example.com'},
        GatherContext: {gatherMode: 'snapshot'},
      },
      runnerOptions: {
        config: {},
        computedCache: new Map(),
      },
    });

    navigationModule.navigationGather.mockReset();
    navigationModule.navigationGather.mockResolvedValue({
      artifacts: {
        URL: {finalUrl: 'https://www.example.com'},
        GatherContext: {gatherMode: 'navigation'},
      },
      runnerOptions: {
        config: {},
        computedCache: new Map(),
      },
    });

    const timespanGatherResult = {
      artifacts: {
        URL: {finalUrl: 'https://www.example.com'},
        GatherContext: {gatherMode: 'timespan'},
      },
      runnerOptions: {
        config: {},
        computedCache: new Map(),
      },
    };
    const timespan = {endTimespanGather: jest.fn().mockResolvedValue(timespanGatherResult)};
    timespanModule.startTimespanGather.mockReset();
    timespanModule.startTimespanGather.mockResolvedValue(timespan);
  });

  describe('.navigate()', () => {
    it('should throw if a timespan is active', async () => {
      const flow = new UserFlow(mockPage.asPage());
      await flow.startTimespan();
      await expect(flow.navigate('https://example.com')).rejects.toBeTruthy();
    });

    it('should invoke navigation runner', async () => {
      const flow = new UserFlow(mockPage.asPage());

      await flow.navigate('https://example.com/1', {stepName: 'My Step'});

      const configContext = {settingsOverrides: {maxWaitForLoad: 1000}};
      await flow.navigate('https://example.com/2', {configContext});

      await flow.navigate('https://example.com/3');

      expect(navigationModule.navigationGather).toHaveBeenCalledTimes(3);
      expect(flow._gatherSteps).toMatchObject([
        {name: 'My Step'},
        {name: 'Navigation report (www.example.com/)'},
        {name: 'Navigation report (www.example.com/)'},
      ]);
    });

    it('should disable storage reset on subsequent navigations', async () => {
      const flow = new UserFlow(mockPage.asPage());
      await flow.navigate('https://example.com/1');

      // Try once when we have some other settings.
      const configContext = {settingsOverrides: {maxWaitForLoad: 1000}};
      await flow.navigate('https://example.com/2', {configContext});

      // Try once when we don't have any other settings.
      await flow.navigate('https://example.com/3');

      // Try once when we explicitly set it.
      const configContextExplicit = {settingsOverrides: {disableStorageReset: false}};
      await flow.navigate('https://example.com/4', {configContext: configContextExplicit});

      // Check that we have the property set.
      expect(navigationModule.navigationGather).toHaveBeenCalledTimes(4);
      const [[, call1], [, call2], [, call3], [, call4]] =
        navigationModule.navigationGather.mock.calls;
      expect(call1).not.toHaveProperty('configContext.settingsOverrides.disableStorageReset');
      expect(call2).toHaveProperty('configContext.settingsOverrides.disableStorageReset');
      expect(call3).toHaveProperty('configContext.settingsOverrides.disableStorageReset');
      expect(call4).toHaveProperty('configContext.settingsOverrides.disableStorageReset');
      expect(call2.configContext.settingsOverrides.disableStorageReset).toBe(true);
      expect(call3.configContext.settingsOverrides.disableStorageReset).toBe(true);
      expect(call4.configContext.settingsOverrides.disableStorageReset).toBe(false);

      // Check that we didn't mutate the original objects.
      expect(configContext).toEqual({settingsOverrides: {maxWaitForLoad: 1000}});
      expect(configContextExplicit).toEqual({settingsOverrides: {disableStorageReset: false}});
    });

    it('should disable about:blank jumps by default', async () => {
      const flow = new UserFlow(mockPage.asPage());
      await flow.navigate('https://example.com/1');

      // Try once when we have some other settings.
      const configContext = {settingsOverrides: {maxWaitForLoad: 1000}};
      await flow.navigate('https://example.com/2', {configContext});

      // Try once when we explicitly set it.
      const configContextExplicit = {skipAboutBlank: false};
      await flow.navigate('https://example.com/3', {configContext: configContextExplicit});

      // Check that we have the property set.
      expect(navigationModule.navigationGather).toHaveBeenCalledTimes(3);
      const [[, call1], [, call2], [, call3]] = navigationModule.navigationGather.mock.calls;
      expect(call1).toHaveProperty('configContext.skipAboutBlank');
      expect(call2).toHaveProperty('configContext.skipAboutBlank');
      expect(call3).toHaveProperty('configContext.skipAboutBlank');
      expect(call1.configContext.skipAboutBlank).toBe(true);
      expect(call2.configContext.skipAboutBlank).toBe(true);
      expect(call3.configContext.skipAboutBlank).toBe(false);

      // Check that we didn't mutate the original objects.
      expect(configContext).toEqual({settingsOverrides: {maxWaitForLoad: 1000}});
      expect(configContextExplicit).toEqual({skipAboutBlank: false});
    });
  });

  describe('.startTimespan()', () => {
    it('should throw if a timespan is active', async () => {
      const flow = new UserFlow(mockPage.asPage());
      await flow.startTimespan();
      await expect(flow.startTimespan()).rejects.toBeTruthy();
    });

    it('should invoke timespan runner', async () => {
      const flow = new UserFlow(mockPage.asPage());

      await flow.startTimespan({stepName: 'My Timespan'});
      await flow.endTimespan();

      await flow.startTimespan();
      await flow.endTimespan();

      expect(timespanModule.startTimespanGather).toHaveBeenCalledTimes(2);
      expect(flow._gatherSteps).toMatchObject([
        {name: 'My Timespan'},
        {name: 'Timespan report (www.example.com/)'},
      ]);
    });
  });

  describe('.endTimespan()', () => {
    it('should throw if a timespan has not started', async () => {
      const flow = new UserFlow(mockPage.asPage());
      await expect(flow.endTimespan()).rejects.toBeTruthy();
    });
  });

  describe('.snapshot()', () => {
    it('should throw if a timespan is active', async () => {
      const flow = new UserFlow(mockPage.asPage());
      await flow.startTimespan();
      await expect(flow.snapshot()).rejects.toBeTruthy();
    });

    it('should invoke snapshot runner', async () => {
      const flow = new UserFlow(mockPage.asPage());

      await flow.snapshot({stepName: 'My Snapshot'});
      await flow.snapshot();

      expect(snapshotModule.snapshotGather).toHaveBeenCalledTimes(2);
      expect(flow._gatherSteps).toMatchObject([
        {name: 'My Snapshot'},
        {name: 'Snapshot report (www.example.com/)'},
      ]);
    });
  });

  describe('.getFlowResult', () => {
    it('should throw if no flow steps have been run', async () => {
      const flow = new UserFlow(mockPage.asPage());
      const flowResultPromise = flow.createFlowResult();
      await expect(flowResultPromise).rejects.toThrow(/Need at least one step/);
    });

    it('should audit active gather steps', async () => {
      mockRunner.audit.mockImplementation(artifacts => ({
        lhr: {
          finalUrl: artifacts.URL.finalUrl,
          gatherMode: artifacts.GatherContext.gatherMode,
        },
      }));
      const flow = new UserFlow(mockPage.asPage());

      await flow.navigate('https://www.example.com/');
      await flow.startTimespan({stepName: 'My Timespan'});
      await flow.endTimespan();
      await flow.snapshot({stepName: 'My Snapshot'});

      const flowResult = await flow.createFlowResult();
      expect(flowResult).toMatchObject({
        steps: [
          {
            lhr: {finalUrl: 'https://www.example.com', gatherMode: 'navigation'},
            name: 'Navigation report (www.example.com/)',
          },
          {
            lhr: {finalUrl: 'https://www.example.com', gatherMode: 'timespan'},
            name: 'My Timespan',
          },
          {
            lhr: {finalUrl: 'https://www.example.com', gatherMode: 'snapshot'},
            name: 'My Snapshot',
          },
        ],
        name: 'User flow (www.example.com)',
      });
    });
  });

  describe('auditGatherSteps', () => {
    it('should audit gather steps', async () => {
      const runnerActual = jest.requireActual('../../runner.js');
      mockRunner.getGathererList.mockImplementation(runnerActual.getGathererList);
      mockRunner.getAuditList.mockImplementation(runnerActual.getAuditList);
      mockRunner.audit.mockImplementation(artifacts => ({
        lhr: {
          finalUrl: artifacts.URL.finalUrl,
          gatherMode: artifacts.GatherContext.gatherMode,
        },
      }));

      /** @type {LH.Config.Json} */
      const flowConfig = {
        extends: 'lighthouse:default',
        settings: {
          skipAudits: ['uses-http2'],
        },
      };

      /** @type {LH.Config.Json} */
      const timespanConfig = {
        extends: 'lighthouse:default',
        settings: {
          onlyCategories: ['performance'],
        },
      };

      /** @type {LH.Config.FRContext} */
      const snapshotContext = {
        settingsOverrides: {
          onlyCategories: ['accessibility'],
        },
      };

      /** @type {LH.UserFlow.GatherStep[]} */
      const gatherSteps = [
        {
          name: 'Navigation',
          // @ts-expect-error Only these artifacts are used by the test.
          artifacts: {
            URL: {
              requestedUrl: 'https://www.example.com',
              finalUrl: 'https://www.example.com',
            },
            GatherContext: {gatherMode: 'navigation'},
          },
        },
        {
          name: 'Timespan',
          // @ts-expect-error Only these artifacts are used by the test.
          artifacts: {
            URL: {
              requestedUrl: 'https://www.example.com',
              finalUrl: 'https://www.example.com',
            },
            GatherContext: {gatherMode: 'timespan'},
          },
          config: timespanConfig,
        },
        {
          name: 'Snapshot',
          // @ts-expect-error Only these artifacts are used by the test.
          artifacts: {
            URL: {
              requestedUrl: 'https://www.example.com',
              finalUrl: 'https://www.example.com',
            },
            GatherContext: {gatherMode: 'snapshot'},
          },
          configContext: snapshotContext,
        },
      ];

      const flowResult = await auditGatherSteps(gatherSteps, {config: flowConfig});

      expect(mockRunner.audit.mock.calls).toMatchObject([
        [
          gatherSteps[0].artifacts,
          {
            config: {
              settings: {
                skipAudits: ['uses-http2'],
              },
            },
          },
        ],
        [
          gatherSteps[1].artifacts,
          {
            config: {
              settings: {
                onlyCategories: ['performance'],
              },
            },
          },
        ],
        [
          gatherSteps[2].artifacts,
          {
            config: {
              settings: {
                onlyCategories: ['accessibility'],
              },
            },
          },
        ],
      ]);

      expect(flowResult).toMatchObject({
        steps: [
          {
            lhr: {finalUrl: 'https://www.example.com', gatherMode: 'navigation'},
            name: 'Navigation',
          },
          {
            lhr: {finalUrl: 'https://www.example.com', gatherMode: 'timespan'},
            name: 'Timespan',
          },
          {
            lhr: {finalUrl: 'https://www.example.com', gatherMode: 'snapshot'},
            name: 'Snapshot',
          },
        ],
        name: 'User flow (www.example.com)',
      });
    });
  });
});

