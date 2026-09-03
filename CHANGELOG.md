## 1.0.5

### Improvements & Fixes

- Aligned Smart TV plugin execution and stream searching with Android TV, including exception containment, provider scheduling, shared sessions, profile synchronization, and pause/resume lifecycle (@WhiteGiso)
- Kept Tizen EngineFS and PluginService independent, on-demand, and separately packaged for direct installation and Apps2Samsung while preserving their distinct ports and identifiers (@WhiteGiso)
- Added runtime notices and translations for TVs where plugin execution is unsupported or limited, without adding messages on fully supported runtimes (@WhiteGiso)
- Hardened TV input/navigation and Tizen/WebOS service handling while retaining warnings and errors for real failures only (@WhiteGiso)

## 1.0.4

### Improvements & Fixes

- Hardened Continue Watching, library loading, and remote progress state so profile changes and delayed synchronization do not replace valid TV content with a temporary empty view (@WhiteGiso)
- Aligned plugin execution with Android behavior by preserving eligible provider work in a cancellable queue and isolating legacy plugin data and migrations per profile (@WhiteGiso)
- Improved Home hero metadata and artwork transitions, Tizen live HLS fallback, and Library/Plugins focus restoration for Samsung TV navigation (@WhiteGiso)
- Aligned plugin synchronization with Android by pulling the remote snapshot before any pending push, so opaque legacy rows cannot block classification and provider hydration (@WhiteGiso)
- Added independent Tizen EngineFS and PluginService lifecycles and ports, preserving lazy P2P startup and starting PluginService on demand during plugin synchronization or the first plugin request, with runtime diagnostics and duplicate-port handling (@WhiteGiso)
- Strengthened Tizen WGT packaging and Samsung installer validation so both service files, bridge, and manifest declarations are checked before installation (@WhiteGiso)

## 1.0.3

### Improvements & Fixes

- Finalized the Tizen plugin-service lifecycle, packaging contract, local health probing, launcher fallbacks, plugin HTTP playback proxy, and localized plugin UI handling (@WhiteGiso)
- Scoped plugin repositories, provider code, and cloud synchronization to the effective profile, including revision and dirty-state protection against cross-profile updates (@WhiteGiso)
- Preserved profile-bound local repository changes during remote reconciliation so stale snapshots cannot overwrite recent TV updates (@WhiteGiso)
- Moved provider-code caching from synchronous `localStorage` to profile-keyed asynchronous IndexedDB with bounded eviction, memory fallback, cleanup handling, authentication/profile integration, and the required Tizen storage privilege (@WhiteGiso)
- Restored the existing detail route after playback, targeting the correct history entry and avoiding duplicate detail screens while retaining stream cleanup (@WhiteGiso)
- Removed test programs and plugin fixtures from tracked application directories, keeping local test assets exclusively under the ignored root `tests/` directory (@WhiteGiso)
