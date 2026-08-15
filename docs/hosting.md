# Hosting dps.bopsec.com

This fork is a static Next.js export. The build output is the `out` directory, so it can be hosted on Cloudflare Pages without running a server.

## Recommended Setup

1. Push `local-dps-calc` to `bopsec/custom-wiki-dps`.
2. In Cloudflare, create a Pages project from the GitHub repository.
3. Set the production branch to `local-dps-calc`.
4. Use the `Next.js (Static HTML Export)` preset:
   - Build command: `yarn build`
   - Build output directory: `out`
5. Add environment variables:
   - `NEXT_PUBLIC_BASE_URL=https://dps.bopsec.com`
   - `NEXT_PUBLIC_SOURCE_URL=https://github.com/bopsec/custom-wiki-dps`
   - Optional: `NEXT_PUBLIC_CDN_BASE=<your hosted CDN path>`
6. Add the custom domain `dps.bopsec.com` in the Cloudflare Pages project.

Cloudflare Pages will rebuild and redeploy whenever `local-dps-calc` is pushed.

## Updating From Weird Gloop

Use the GitHub Actions workflow named `Sync upstream into local DPS calc`.

It can be run manually from the Actions tab and also runs daily. It fetches `weirdgloop/osrs-dps-calc`, merges `upstream/main` into `local-dps-calc`, and pushes the result to your fork. If there are merge conflicts, the workflow fails and the conflict needs to be resolved locally.
