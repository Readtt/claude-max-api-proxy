# Auto-start on macOS

Run the proxy automatically at login with a LaunchAgent.

## 1. Create the plist

Replace `YOUR_USERNAME` and the path to `standalone.js`. Check binaries with
`which node` and `which claude`.

```bash
cat > ~/Library/LaunchAgents/com.claude-max-proxy.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>            <string>com.claude-max-proxy</string>
    <key>RunAtLoad</key>        <true/>
    <key>KeepAlive</key>        <true/>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>/path/to/claude-max-api-proxy/dist/server/standalone.js</string>
    </array>
    <key>StandardOutPath</key>  <string>/tmp/claude-max-proxy.log</string>
    <key>StandardErrorPath</key><string>/tmp/claude-max-proxy.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>HOME</key><string>/Users/YOUR_USERNAME</string>
      <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
</plist>
PLIST
```

## 2. Start it

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.claude-max-proxy.plist
curl http://localhost:3456/health
```

## Manage

```bash
# restart
launchctl kickstart -k gui/$(id -u)/com.claude-max-proxy
# stop / uninstall
launchctl bootout gui/$(id -u)/com.claude-max-proxy
rm ~/Library/LaunchAgents/com.claude-max-proxy.plist
# logs
tail -f /tmp/claude-max-proxy.err.log
```

If the health check fails, check that log — usually a wrong path to
`standalone.js`, or `node`/`claude` not on the LaunchAgent's `PATH`.
