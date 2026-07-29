# mxcli-timeregistration

A Mendix time & billing application for a Dutch law firm, built from a design
handoff with [mxcli](https://github.com/ako/mxcli) and MDL.

```bash
bash scripts/setup-tools.sh          # toolchain (runs automatically each session)
cd TimeRegistration
./mxcli run --local -p TimeRegistration.mpr --ensure-db --watch
```

- **[APP.md](APP.md)** — what the app does, its domain model, and where it
  departs from the handoff.
- **[TOOLING.md](TOOLING.md)** — installed versions, the pinned mxcli commit, and
  how the toolchain rebuilds itself.

The whole application is defined by the MDL scripts in
`TimeRegistration/mdlsource/` — domain model, business logic, pages, navigation
and demo data.
