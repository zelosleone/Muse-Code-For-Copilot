# Muse Code for Copilot

Use your Meta Muse Code subscription in GitHub Copilot Chat. No API key needed.

1. Run **Muse Code: Sign In** and approve the code in your browser.
2. Pick a Muse model in the Copilot Chat model picker.
3. Set its reasoning effort right in the picker.

Models, context windows and effort levels come live from Meta. If Meta doesn't publish a default effort for a model, the picker starts at Auto and lets Meta decide. Copilot's context window indicator and prompt caching work as usual.

**Muse Code: Sign Out** removes the stored session. **Muse Code: Manage** shows who is signed in and can refresh models, sign in or out, or open the logs.

## Development

```sh
npm install
npm run compile
npm run lint      # includes a complexity cap of 8
npx -y knip       # unused files, exports and dependencies
npm run package   # builds the .vsix
```

Unofficial, not affiliated with Meta. Muse, Muse Code and Muse Spark are trademarks of Meta.
