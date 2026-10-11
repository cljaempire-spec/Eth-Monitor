# ETH Thesis Monitor (free)

Static dashboard + a daily GitHub Action that collects data from free public APIs.
Cost: $0 (GitHub Free: Actions + Pages).

## Setup (about 5 minutes)
1. Create a new GitHub repo (public is simplest) and upload everything in this folder, including the hidden `.github` folder.
2. Settings > Pages > Source: "Deploy from a branch" > `main` / root. Your dashboard URL appears there.
3. Actions tab > "update-data" > Run workflow. Check the run log, then refresh the page (the step takes ~1 minute).
4. Optional phone alerts: install the free **ntfy** app, subscribe to a hard-to-guess topic name, then add a repo secret `NTFY_TOPIC` with that name (Settings > Secrets and variables > Actions).

## Data
| Auto (free APIs) | Needs you (data/manual.json) |
|---|---|
| ETH price, stablecoin supply and Ethereum/Solana share, DeFi TVL share, network fees, RWA TVL, L2 TVL, DEX volume, staked share, supply growth | AI-agent stats, ETF flows, institutional holdings, BMNR holdings / diluted shares / share price (mNAV and ETH per share are then computed) |

Metrics marked "builds daily" have no free history, so their charts fill in one point per day from the first run.

## Known limits
- Endpoints were checked against public docs and a mocked test, not live calls. If a source breaks, the dashboard shows it under "Data sources with problems" and keeps all other data.
- ETH burned/day has no keyless free source; fees/day is used as a proxy.
- Edit `data/metrics.json` to change names, alert thresholds, or what counts as good (gd: 1 = higher is better, -1 = lower is better).
- GitHub pauses scheduled runs after ~60 days of no repo activity; re-enable in the Actions tab if so.
