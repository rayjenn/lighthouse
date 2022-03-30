# Chromium Web Tests

This runs the Chromium webtests using the devtools integration tester.

`third-party/chromium-web-tests/webtests` contains all of our Lighthouse webtests.

## Run

```sh
yarn test-devtools

# Reset the results.
yarn update:test-devtools

# Run the test runner, without updating content_shell or getting the latest
# DevTools commits like `yarn test-devtools` does.
# This still bundles Lighthouse + rolls to DevTools before running the tests.
SKIP_DOWNLOADS=1 yarn test-devtools
```

### Prerequistes

<details>
  <summary>Install python dependencies</summary>

  Ensure you have these modules available globally on your python 3.x install:

  ```sh
  python3 -m pip install requests six
  ```

</details>

### Debugging

* Want logs from Lighthouse? Add `log.log('status', '**** hello test output ' + JSON.stringify({obj}));` which will be visible in the `lighthouse-successful-run.js` output thanks to `LighthouseTestRunner.addStatusListener`.
* Want logs from test files? Adding these flags to the invocation `yarn test-devtools --driver-logging --no-retry-failures` will print to terminal.
* Want logs from the inspected page? Add `testRunner.setDumpConsoleMessages(true);` to a test file. (also, [beware](https://source.chromium.org/chromium/chromium/src/+/main:content/web_test/renderer/web_view_test_proxy.cc;l=125-129;drc=437e5d9a05535b9e2cd7b983f78b23ebc3d92b3f) w/e this is about)


## How it works

Normally, running these webtests requires a full Chromium checkout. However, that takes much too long, so it wouldn't be feasible for daily development or CI. Instead, we:

1) **Grab just the source files we need from the Chromium repos**

`download-blink-tools.sh` downloads just the code needed to run `third_party/blink/tools/run_web_tests.py`. This includes

* `third_party/blink/tools`.
* `third_party/blink/web_tests/fast/harness`
* [`third_party/catapult/third_party/typ`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/catapult/third_party/typ/)–necessary third party Python library

2) **Apply a few custom patches**

`run_web_tests.py` normally uses Apache to host the webtest resources while the tests run. However, Apache is a very heavy dependency, and doesn't work well in GitHub actions. The majority of how Apache is configured is unnecessary for our layout tests, so instead `npx http-server` is used. How the web server is launched is not configurable in `run_web_tests.py`, so instead we apply a small patch to skip its usage.

`run_web_tests.py` also verifies that `image_diff` has been built from the Chromium checkout. We don't need that in our tests, so we skip that check. It's only for screenshot tests.

`run_web_tests.py` requires a content shell binary. Instead of building it, we download it.

3) **Download a prebuilt content shell** (barebones Chromium that is used by webtests)

DevTools had a script for this, but it was removed. `download-content-shell.js` is from the old script, but with only the content shell downloading code and with a couple of minor changes.

4) **Check out DevTools frontend, roll Lighthouse, build, and extract inspector resources**

To run the devtools webtests, `run_web_tests.py` requires the inspector resources (the output of the frontend build process). These files are actually included in the content shell download from before, but instead we want to build the currently checked out Lighthouse, roll to DevTools, build DevTools, and use the newly created inspector files.

`run_web_tests.py` normally serves these files by mounting the Chromium build folder for the DevTools output to the path `/inspector-sources` [1](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/tools/blinkpy/web_tests/port/base.py;l=1280;drc=e8e4dcd1d1684251c33cda9b9fc93d7ea808e4bd) [2](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/tools/blinkpy/web_tests/servers/apache_http.py;l=118;drc=32408e19204a7ffceebfe774d7e99f2041cf4338). Instead, we fetch the DevTools frontend, roll Lighthouse, build it, then copy the build output to the `inspector-sources` at the root of our `npx http-server` web server.

## Testing Lighthouse from DevTools

`run_web_tests.py` is used to automatically test Lighthouse from DevTools.

```sh
# Runs Lighthouse from DevTools. Outputs results to ./latest-run/devtools-lhr.json.
yarn run-devtools http://example.com
```

## TODO

* Keep LighthouseTestRunner here too.
* Implement `findMostRecentChromiumCommit` in `download-content-shell.js`
* Run smoke tests (started awhile ago [here](https://chromium-review.googlesource.com/c/chromium/src/+/1739566/3/third_party/blink/web_tests/http/tests/devtools/audits/audits-smoke-run.js)).
* auto commit rebaseline in CI [1]

[1] The following would work for the core members, but not external contributors.
```
# TODO: Must create a new token so external contributors can use.
# - name: Reset Results
#   if: failure() && github.actor != 'patrickhulce' && github.actor != 'brendankenny'
#   run: bash $GITHUB_WORKSPACE/lighthouse/lighthouse-core/test/chromium-web-tests/run-web-tests.sh --reset-results
# - name: Commit new expectations
#   if: failure() && github.actor != 'patrickhulce' && github.actor != 'brendankenny'
#   uses: EndBug/add-and-commit@v4
#   with:
#     cwd: ${{ github.workspace }}/lighthouse
#     add: third-party/chromium-webtests/webtests
#     message: update webtest expectations
#   env:
#     GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### FAQ

#### How to modify blink-tools.patch?

Simply make your changes in `.tmp/chromium-web-tests/blink_tools/latest`, and run: `git -C .tmp/chromium-web-tests/blink_tools/latest diff > lighthouse-core/test/chromium-web-tests/blink-tools.patch`

#### How does the python module `typ` get added to python sys path?

Via a [hack](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/tools/blinkpy/web_tests/models/typ_types.py;l=7?q=add_typ_dir_to_sys_path).
