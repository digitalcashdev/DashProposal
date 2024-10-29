# DashProposal

A fully Web-based tool for submitting project proposals to the Digital Cash
network.

## Install

1. Clone and Enter
   ```sh
   git clone https://github.com/digitalcashdev/DashProposal.git ./DashProposal/
   pushd ./DashProposal/
   ```
2. Serve over localhost HTTPS
   ```sh
   # caddy run --config ./Caddyfile --adapter caddyfile
   ./scripts/serve
   ```
   Note: use [setcap-netbind](https://webinstall.dev/setcap-netbind) to run as
   non-root on Linux
3. Open the DashProposal: \
   <https://local.digitalcash.dev>

## Deploy

1. Edit `Caddyfile.example` to match your production system.
2. Install `serviceman`
   ```sh
   curl https://webi.sh/serviceman | sh
   ```
3. Create the systemd unit file for `caddy`
   ```sh
   sudo env PATH="$PATH" \
       serviceman add --name "caddy" --system --path="$PATH" -- \
       caddy run --config ./Caddyfile --adapter caddyfile
   ```

You can add any number of domains, reverse proxies, and other apps.
