# User Flows in Lighthouse

> Motivation: You want to run Lighthouse on your whole site, not just the landing page.

> Is that checkout form after you add an item to your cart accessible?

> What is the Cumulative Layout Shift of my SPA page transition?

You want Lighthouse on a _flow_, not just a page load.

This document describes how Lighthouse measures flows and offers recommendations on how to structure your own flow measurement with practical examples.

## Flow Building Blocks

Flow measurement in Lighthouse is enabled by three modes: navigations, timespans, and snapshots. Each mode has its own unique use cases, benefits, and limitations. Later, you'll create a flow by combining these three core report types.

### Navigation

Navigation reports analyze a single page load. Navigation is the most common type of report you'll see. In fact, all Lighthouse reports prior to v9 are navigation reports.

#### Benefits

- Provides an overall performance score and all metrics.
- Contains the most advice of all report types (both time-based and state-based audits are available).

#### Limitations

- Cannot analyze form submissions or single page app transitions.
- Cannot analyze content that isn't available immediately on page load.

#### Use Cases

- Obtain a Lighthouse Performance score.
- Measure Performance metrics (First Contentful Paint, Largest Contentful Paint, Speed Index, Time to Interactive, Cumulative Layout Shift, Total Blocking Time).
- Assess Progressive Web App capabilities.

#### Triggering a navigation via user interactions

Instead of providing a URL to navigate to, you can provide a callback function. This is useful when you want to audit a navigation where the destination is unknown before navigating.

> Aside: Lighthouse typically clears out any active Service Worker and Cache Storage for the origin under test. However, in this case, as it doesn't know the URL being analyzed, Lighthouse cannot clear this storage. This generally reflects the real user experience, but if you still wish to clear the Service Workers and Cache Storage you must do it manually.

This callback function _must_ perform an action that will trigger a navigation. Any interactions completed before the callback promise resolves will be captured by the navigation.

#### Code

```js
import {writeFileSync} from 'fs';
import puppeteer from 'puppeteer';
import api from 'lighthouse/lighthouse-core/fraggle-rock/api.js';

async function main() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const flow = await api.startFlow(page);

  // Navigate with a URL
  await flow.navigate('https://example.com');

  // Navigate with a callback function
  await flow.navigate(async () => {
    await page.click('a.link');
  });

  await browser.close();

  writeFileSync('report.html', await flow.generateReport());
}

main();
```

### Timespan

Timespan reports analyze an arbitrary period of time, typically containing user interactions, and have similar use cases to the Performance Panel in DevTools.

#### Benefits

- Provides range-based metrics such as Total Blocking Time and Cumulative Layout Shift.
- Analyzes any period of time, including user interactions or single page app transitions.

#### Limitations

- Does not provide an overall performance score.
- Cannot analyze moment-based performance metrics (e.g. Largest Contentful Paint).
- Cannot analyze state-of-the-page issues (e.g. no Accessibility category)

#### Use Cases

- Measure layout shifts and JavaScript execution time on a series of interactions.
- Discover performance opportunities to improve the experience for long-lived pages and SPAs.

#### Code

```js
import {writeFileSync} from 'fs';
import puppeteer from 'puppeteer';
import api from 'lighthouse/lighthouse-core/fraggle-rock/api.js';

async function main() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  const flow = await api.startFlow(page);

  await flow.beginTimespan();
  await page.type('#username', 'lighthouse');
  await page.type('#password', 'L1ghth0useR0cks!');
  await page.click('#login');
  await page.waitForSelector('#dashboard');
  await flow.endTimespan();

  await browser.close();

  writeFileSync('report.html', await flow.generateReport());
}

main();
```

### Snapshot

Snapshot reports analyze the page in a particular state, typically after the user has interacted with it, and have similar use cases to the Elements Panel in DevTools.

#### Benefits

- Analyzes the page in its current state.

#### Limitations

- Does not provide an overall performance score or metrics.
- Cannot analyze any issues outside the current DOM (e.g. no network, main-thread, or performance analysis).

#### Use Cases

- Find accessibility issues in single page applications or complex forms.
- Evaluate best practices of menus and UI elements hidden behind interaction.

#### Code

```js
import {writeFileSync} from 'fs';
import puppeteer from 'puppeteer';
import api from 'lighthouse/lighthouse-core/fraggle-rock/api.js';

async function main() {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  const flow = await api.startFlow(page);

  await page.click('#expand-sidebar');
  await flow.snapshot();

  await browser.close();

  writeFileSync('report.html', await flow.generateReport());
}

main();
```

## Creating a Flow

So far we've seen individual Lighthouse modes in action. The true power of flows comes from combining these building blocks into a comprehensive flow to capture the user's entire experience.

### Selecting Boundaries

When mapping a user flow onto the Lighthouse modes, strive for each report to have a narrow focus. This will make debugging much easier when you have issues to fix! Use the following guide when crafting your timespan and snapshot checkpoints.

![image](https://user-images.githubusercontent.com/2301202/135167873-4a867444-55c3-4bfb-814b-0a536bf4ddef.png)


1. `.navigate` to the URL of interest, proceed to step 2.
2. Are you interacting with the page?
    1. Yes - Proceed to step 3.
    2. No - End your flow.
3. Are you clicking a link?
    1. Yes - Proceed to step 1.
    2. No - Proceed to step 4.
4. `.startTimespan`, proceed to step 5.
5. Has the page or URL changed significantly during the timespan?
    1. Yes - Proceed to step 6.
    2. No - Either wait for a significant change or end your flow.
6. `.stopTimespan`, proceed to step 7.
7. `.snapshot`, proceed to step 2.


The below example codifies a user flow for an ecommerce site where the user navigates to the homepage, searches for a product, and clicks on the detail link.

![Lighthouse User Flows Diagram](https://user-images.githubusercontent.com/2301202/135164371-20cc5c8c-e876-467f-985c-f85683afa8ee.png)


### Code

```js
import {writeFileSync} from 'fs';
import puppeteer from 'puppeteer';
import * as pptrTestingLibrary from 'pptr-testing-library';
import api from 'lighthouse/lighthouse-core/fraggle-rock/api.js';

const {getDocument, queries} = pptrTestingLibrary;

async function search(page) {
  const $document = await getDocument(page);
  const $searchBox = await queries.getByLabelText($document, /type to search/i);
  await $searchBox.type('Xbox Series X');
  await Promise.all([
    $searchBox.press('Enter'),
    page.waitForNavigation({waitUntil: ['load', 'networkidle2']}),
  ]);
}

async function main() {
  // Setup the browser and Lighthouse.
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const flow = await api.startFlow(page);

  // Phase 1 - Navigate to our landing page.
  await flow.navigate('https://www.bestbuy.com');

  // Phase 2 - Interact with the page and submit the search form.
  await flow.startTimespan();
  await search(page);
  await flow.endTimespan();

  // Phase 3 - Analyze the new state.
  await flow.snapshot();

  // Phase 4 - Navigate to a detail page.
  await flow.navigate(async () => {
    const $document = await getDocument(page);
    const $link = await queries.getByText($document, /Xbox Series X 1TB Console/);
    $link.click();
  });

  // Get the comprehensive flow report.
  writeFileSync('report.html', await flow.generateReport());
  // Save results as JSON.
  writeFileSync('flow-result.json', JSON.stringify(await flow.createFlowResult(), null, 2));

  // Cleanup.
  await browser.close();
}

main();
```

## Tips and Tricks

- Keep timespan recordings _short_ and focused on a single interaction sequence or page transition.
- Use snapshot recordings when a substantial portion of the page content has changed.
- Always wait for transitions and interactions to finish before ending a timespan. `page.waitForSelector`/`page.waitForFunction`/`page.waitForResponse`/`page.waitForTimeout` are your friends here.

## Related Reading

- [User Flows Issue](https://github.com/GoogleChrome/lighthouse/issues/11313)
- [User Flows Design Document](https://docs.google.com/document/d/1fRCh_NVK82YmIi1Zq8y73_p79d-FdnKsvaxMy0xIpNw/edit#heading=h.b84um9ao7pg7)
- [User Flows Timeline Diagram](https://docs.google.com/drawings/d/1jr9smqqSPsLkzZDEyFj6bvLFqi2OUp7_NxqBnqkT4Es/edit?usp=sharing)
- [User Flows Decision Tree Diagram](https://whimsical.com/lighthouse-flows-decision-tree-9qPyfx4syirwRFH7zdUw8c)
