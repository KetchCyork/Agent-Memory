# Tailscale setup (the mesh fabric)

Tailscale is a WireGuard mesh that gives all your machines a private, encrypted
network and a stable name each, regardless of location or NAT. The free Personal
plan covers this setup (up to 6 users, unlimited personal devices). It's the layer
that lets an agent on one machine reach the memory brain and the Paperclip server
on another.

## 1. Install + sign in (each machine)

Install Tailscale on all three machines and your phone, signing in with the same
account so they share one tailnet:

- macOS (2026 MacBook Pro, 2017 if it ran macOS): `brew install tailscale` or the App Store app
- Linux (2017 MacBook Pro): `curl -fsSL https://tailscale.com/install.sh | sh` then `sudo tailscale up`
- Windows laptop: the Tailscale installer from tailscale.com/download
- Phone: the iOS/Android app (for monitoring + approvals)

## 2. Turn on MagicDNS

In the Tailscale admin console enable **MagicDNS**, so machines get names like
`mac-2026.<your-tailnet>.ts.net` instead of bare `100.x` IPs. The services below
bind to those names.

## 3. Tag the machines

Give each device a role tag in the admin console (Machines -> ... -> Edit ACL tags):

| Machine | Tag | Role |
| --- | --- | --- |
| MacBook Pro 2026 | `tag:hq` | Paperclip server + memory brain |
| MacBook Pro 2017 (Linux) | `tag:worker` | headless render/research worker |
| Windows laptop | `tag:worknode` | work connectors (M365 / Motion) |

## 4. Lock it down with an ACL

Paste the policy in `tailscale/acl.hujson` into the admin console (Access Controls).
It does three things:

- lets **you** (the owner) reach everything from any device, including your phone;
- lets the worker and work node reach **only** the Paperclip server (`:3100`) and the
  memory API (`:8377`) on HQ — nothing else;
- deliberately grants **no** path into the work node's own services, so client/work
  data on the Windows machine stays private unless you add an explicit rule.

## 5. Point the services at the tailnet

On the HQ machine, share the memory brain across the mesh by binding it to the
tailnet name and requiring a key (see `.env.example`):

```
MEMORY_HOST=mac-2026.<your-tailnet>.ts.net
MEMORY_API_KEY=<a-long-random-string>
```

Start Paperclip in tailnet mode so the workers can reach it:

```
npx paperclipai onboard --yes --bind tailnet
```

## Open-source alternative

If you'd rather not depend on Tailscale's hosted coordinator (relevant for an
open-source product), the same mesh can run on **Headscale** (self-hosted
coordination server) or **NetBird**. The service binding and ACL concepts carry
over; only the control server changes.
