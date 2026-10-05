# Muse Code for Copilot

Use your Meta Muse Code subscription in GitHub Copilot Chat. No API key needed.

1. Run **Muse Code: Sign In** and approve the code in your browser.
2. Pick a Muse model in the Copilot Chat model picker.
3. Set its reasoning effort right in the picker.

Models and effort levels come live from Meta. Copilot's context window indicator and prompt caching work as usual.

## Development

```sh
npm install
npm run compile
npm run lint      # includes a complexity cap of 8
npx -y knip       # unused files, exports and dependencies
npm run package   # builds the .vsix
```

Unofficial, not affiliated with Meta. Muse, Muse Code and Muse Spark are trademarks of Meta.
