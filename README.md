# mxcli-timeregistration

A Mendix time & billing application for a Dutch law firm, built from a design
handoff with [mxcli](https://github.com/ako/mxcli) and MDL.

```bash
bash scripts/setup-tools.sh          # toolchain (runs automatically each session)
cd TimeRegistration
./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch
```

Sign in with any seeded account, password `VdhDemo2026!` —
`m.devries@vdh-law.nl` (fee earner), `j.haverkamp@vdh-law.nl` (partner),
`praktijkbeheer@vdh-law.nl` (practice management).

- **[APP.md](APP.md)** — what the app does, its domain model, its security
  model, and where it departs from the handoff.
- **[FINDINGS.md](FINDINGS.md)** — every mxcli bug, surprise and workaround hit
  while building it, with commands and output.
- **[TOOLING.md](TOOLING.md)** — installed versions, the pinned mxcli commit, and
  how the toolchain rebuilds itself.

The whole application is defined by the MDL scripts in
`TimeRegistration/mdlsource/` — domain model, business logic, pages, navigation
and demo data.
