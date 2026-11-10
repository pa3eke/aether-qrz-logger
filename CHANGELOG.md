# Changelog

## 0.1.1 — 2026-11-10

- Fix deskHPSDR TX-VFO logging: read the explicit TX frequency and reported TX VFO instead of treating idle channel 1 / VFO B as the transmit frequency.
- Restore the working VFO A / VFO B / Follow TX selection behavior from the local version.
- Block saving during inconsistent TX/VFO reports rather than using a stale transmit frequency.
- Add regression tests for normal and split operation with TX on A and B, including simulated QRZ upload payloads.
- Preserve the existing map and other logging functionality.


## 0.1.0 — 2026-10-20

First packaged release of Aether QRZ Logger for macOS. The application interface is in Dutch.

- FlexRadio / AetherSDR frequency, mode and slice tracking via TCI.
- QRZ station lookup and name/country/QTH verification before upload.
- Optional sent S report from the receiver signal meter.
- UTC QSO start time, manual received reports and power in watts.
- Local SQLite history, ADIF export and explicit QRZ upload status.
- QRZ links for the current station and recent contacts.
- QTH map with a great-circle connection line and distance in kilometers.
- Optional home-network access from iPhone/iPad with a temporary access code.
- TCI forwarded through the Mac for mobile browsers; no extra Python dependencies.
- macOS application icon in PNG and ICNS formats.

### Requirements and limits

Python 3.10+, AetherSDR with TCI enabled, and QRZ subscriptions permitting Logbook API INSERT and XML station lookup. Start with `Start logboek.command` for Mac-only access or `Start logboek wifi.command` for trusted home-network access. Keep the Mac and AetherSDR running.

Wi-Fi mode uses HTTP and is intended for a trusted home network, without internet port forwarding. QRZ data uses HTTPS from the Mac. Check proposed signal reports and station locations. Browser popup closing support varies. This is an early release tested with one FlexRadio / AetherSDR setup on macOS, rather than a signed native macOS or iOS application.
