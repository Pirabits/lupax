# Contributing to LupaX

Thanks for helping. Bug reports, fixes and small improvements are all welcome.

By taking part you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Security problems:** don't open a public issue. Follow the [security policy](SECURITY.md).
- **Bugs:** search the [issues](https://github.com/Pirabits/lupax/issues) first, then open one with the bug report template.
- **New features or larger changes:** open an issue to talk it over before you write the code, so your time isn't spent on something that won't be merged.
- **Small fixes** (typos, clear bugs, a failing test): send a pull request straight away.

## Set up

The extension has no build step and no runtime dependencies. It loads straight from this folder.

1. Fork the repository and clone your fork.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the folder.
3. After a change, click the reload button on the LupaX card (and reload the page you're testing on).

Node 22 or later is only needed for the tests:

```sh
npm test            # unit tests
npm run test:e2e    # end-to-end tests in real Chrome (~50 s, headless)
```

The [README](README.md#development) explains the e2e harness and the code layout.

## Ground rules

LupaX makes promises in its store listing and [privacy policy](docs/privacy.html). Changes must keep them:

- **No remote code and no new runtime dependencies.** Everything the extension runs ships in this repository.
- **No data leaves the computer.** No analytics, no accounts, no calls to servers of our own. The only network requests are to the sites whose assets the user exports.
- **No new permissions without a reason.** If a change needs one, say why in the pull request and update `docs/privacy.html`.
- **Functions in `lib/scan.js` stay self-contained.** They're injected into pages, so they can't import anything.
- **The website (`docs/`) loads nothing from other servers.** Fonts, icons and scripts are copied into `docs/assets/`.

## Pull requests

- Keep each pull request to one change.
- Add or update tests for what you changed, and run `npm test` and `npm run test:e2e` before you open it.
- Test by hand anything the e2e tests don't cover (window or desktop recording, desktop screenshots, mic and webcam), and say what you checked.
- Don't bump `version` in `manifest.json`. That happens when a release goes to the Chrome Web Store.

## License and trademarks

LupaX is licensed under the [Apache License 2.0](LICENSE). Unless you say otherwise, anything you submit is licensed under the same terms (section 5 of the license).

The license covers the code, not the name or logo. If you publish your own fork, give it its own name and icons, as [TRADEMARKS.md](TRADEMARKS.md) explains.
