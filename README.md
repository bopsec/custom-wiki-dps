# Bopsec OSRS DPS Calculator

This branch is an unofficial modified fork intended for hosting at
[dps.bopsec.com](https://dps.bopsec.com).

The upstream project is the [OSRS Wiki DPS Calculator](https://github.com/weirdgloop/osrs-dps-calc),
created for the [OSRS Wiki](https://oldschool.runescape.wiki). This fork preserves upstream
license and attribution notices and publishes modified source under GPLv3.

This site is not affiliated with, sponsored by, or endorsed by Jagex, Weird Gloop, or the OSRS Wiki.
RuneScape and Old School RuneScape are trademarks of Jagex Limited.

When hosting this fork, set `NEXT_PUBLIC_BASE_URL=https://dps.bopsec.com`. If you publish the
generated CDN assets yourself, set `NEXT_PUBLIC_CDN_BASE` to that hosted `/cdn` path; otherwise the
app uses the upstream OSRS Wiki DPS calculator CDN.

See [docs/hosting.md](docs/hosting.md) for the Cloudflare Pages setup and the upstream sync workflow.

## Upstream README

# osrs-dps-calc
[![](https://img.shields.io/badge/view%20online-red)](https://tools.runescape.wiki/osrs-dps) ![GitHub contributors](https://img.shields.io/github/contributors/weirdgloop/osrs-dps-calc)

Web-based DPS calculator for Old School RuneScape, created for the [OSRS Wiki](https://oldschool.runescape.wiki).

This calculator determines how well certain loadouts, consisting of equipment, prayers, and buffs, will perform against monsters in the game. It heavily uses data from the OSRS Wiki.

## Contributing
We accept issues and pull requests! [Click here for info](CONTRIBUTING.md).

## Acknowledgements
* Bitterkoekje's [spreadsheet](https://docs.google.com/spreadsheets/d/1wzy1VxNWEAAc0FQyDAdpiFggAfn5U6RGPp2CisAHZW8/edit?pli=1#gid=158500257) for a lot of initial math, formulas, and more
* Many [OSRS Wiki](https://oldschool.runescape.wiki) contributors for information on items, monsters, spells, and more
* ...and all of the [contributors](https://github.com/weirdgloop/osrs-dps-calc/graphs/contributors) to this project!
