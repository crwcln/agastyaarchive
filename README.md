# Agastya Archive

## Site settings

Edit `site-config.js` in the project root to change the displayed version and enable or disable site features. Bump `version` when publishing a site change so returning visitors see the update banner.

Available feature switches: `updateNotices`, `episodeFilters`, `hostPanel`, `episodeDeletion`, `customAudioPlayer`, `transcript`, `episodeScheduling`, `aiDescription`, `transcribeAudio`, and `backgroundMusic`.

## API routes

EdgeOne maps `cloud-functions/api/episodes.js` to `/api/episodes` and `cloud-functions/api/audio.js` to `/api/audio`. Keep those files in the top-level `cloud-functions/api` directory and include the folder in the deployment source. Audio chunks upload through the same-origin function to avoid browser cross-origin upload failures. Redeploy after changing function files.

## Episode tools

The host panel can transcribe audio, generate a description with Gemini, publish now, or schedule a future release. Add GEMINI_API_KEY to the cloud-function environment; optionally set GEMINI_TRANSCRIBE_MODEL and GEMINI_TEXT_MODEL. Scheduled episodes appear publicly when their publish time arrives. The host panel can reschedule, publish now, or delete them.
