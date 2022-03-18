/**
 * @license Copyright 2017 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

const DeprecationsAudit = require('../../audits/deprecations.js');
const assert = require('assert').strict;

/* eslint-env jest */

describe('ConsoleMessages deprecations audit', () => {
  it('passes when no console messages were found', async () => {
    const context = {computedCache: new Map()};
    const auditResult = await DeprecationsAudit.audit({
      ConsoleMessages: [],
      InspectorIssues: {deprecationIssue: []},
      SourceMaps: [],
      Scripts: [],
    }, context);
    assert.equal(auditResult.score, 1);
    assert.equal(auditResult.details.items.length, 0);
  });

  it('handles deprecations that do not have url or line numbers', async () => {
    const context = {computedCache: new Map()};
    const auditResult = await DeprecationsAudit.audit({
      ConsoleMessages: [
        {
          source: 'deprecation',
          text: 'Deprecation message',
        },
      ],
      InspectorIssues: {deprecationIssue: []},
      SourceMaps: [],
      Scripts: [],
    }, context);
    assert.equal(auditResult.score, 0);
    expect(auditResult.displayValue).toBeDisplayString('1 warning found');
    assert.equal(auditResult.details.items.length, 1);
    assert.equal(auditResult.details.items[0].source, undefined);
  });

  it('fails when deprecation messages are found (ConsoleMessages)', async () => {
    const URL = 'http://example.com';

    const context = {computedCache: new Map()};
    const auditResult = await DeprecationsAudit.audit({
      ConsoleMessages: [
        {
          source: 'deprecation',
          lineNumber: 123,
          url: URL,
          text: 'Deprecation message 123',
        }, {
          source: 'deprecation',
          lineNumber: 456,
          url: 'http://example2.com',
          text: 'Deprecation message 456',
        }, {
          source: 'somethingelse',
          lineNumber: 789,
          url: 'http://example3.com',
          text: 'Not a deprecation message 789',
        },
      ],
      InspectorIssues: {deprecationIssue: []},
      SourceMaps: [],
      Scripts: [],
    }, context);
    assert.equal(auditResult.score, 0);
    expect(auditResult.displayValue).toBeDisplayString('2 warnings found');
    assert.equal(auditResult.details.items.length, 2);
    assert.equal(auditResult.details.items[0].source.url, URL);
    assert.equal(auditResult.details.items[0].source.line, 123);
  });

  it('fails when deprecation messages are found', async () => {
    const URL = 'http://example.com';

    const context = {computedCache: new Map()};
    const auditResult = await DeprecationsAudit.audit({
      ConsoleMessages: [
        {
          source: 'deprecation',
          lineNumber: 456,
          url: 'http://example2.com',
          text: 'Ignore me b/c there are InspectorIssues',
        },
      ],
      InspectorIssues: {
        deprecationIssue: [
          {
            message: 'Deprecation message 123',
            sourceCodeLocation: {
              url: URL,
              lineNumber: 123,
              columnNumber: 100,
            },
          },
          {
            message: 'Deprecation message 456',
            sourceCodeLocation: {
              url: 'http://example2.com',
              lineNumber: 456,
              columnNumber: 100,
            },
          },
        ],
      },
      SourceMaps: [],
      Scripts: [],
    }, context);

    assert.equal(auditResult.score, 0);
    expect(auditResult.displayValue).toBeDisplayString('2 warnings found');
    assert.equal(auditResult.details.items.length, 2);
    assert.equal(auditResult.details.items[0].value, 'Deprecation message 123');
    assert.equal(auditResult.details.items[0].source.url, URL);
    assert.equal(auditResult.details.items[0].source.line, 123);
    assert.equal(auditResult.details.items[0].source.column, 99);
  });
});
