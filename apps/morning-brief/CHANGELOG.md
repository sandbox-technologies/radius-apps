# Changelog

## 1.1.0 — explicit local dashboard (unreleased)

- Added a local vanilla HTML/CSS/JS tab view with capability/grant discovery,
  explicit Run now, public receipts/effects, bounded checking, and cancellation.
- Displayed optional host generation reasons separately from grants and
  required/admitted budget ceilings separately from actual usage. Missing
  metadata stays unknown; no runner limits are hard-coded in the UI.
- Added optional `readReports` for owned artifact metadata; opening remains a
  separate `openReports` grant and explicit click, never generation or delivery
  on load. Generation's three required grants and metadata scope are unchanged.
- Added read-only bound-instance configuration and schedule display using
  feature-checked preview methods, with native-management guidance on older
  hosts. Configuration/grant/schedule mutations remain user-only host work.
- Added optional `todayPriorities` (at most 2,000 Unicode code points) and a
  prompt for the coordinated bounded untrusted generation-context envelope.
  Existing required fields and instance state schema version stay compatible.
- Added developer documentation and DOM/SDK-double coverage; no model calls,
  signing, or app-store publication. Separate local host checks exercised the
  installed UI; full isolated native acceptance remains pending.
- Kept in-page guidance and skip navigation within the exact document URL by
  scrolling/focusing without changing its fragment.
- Kept generation unavailable on the current host, the experimental status,
  and an empty screenshot list. Bundle changes require a new reviewed digest.

## 1.0.1 — MIT source publication

- Licensed the app under MIT and included the license notice in the bundle.
- Bumped the patch version because the packaged license changes bundle bytes.
- Kept experimental status and existing native availability restrictions.

## 1.0.0 — catalog bootstrap

- Extracted the schema-2 manifest and prompt with unchanged bundle bytes.
- Added metadata and offline manifest/prompt tests, with no provider calls.
- Kept native generation blocked and schedules disabled unless separately
  authorized on a future capable host.
