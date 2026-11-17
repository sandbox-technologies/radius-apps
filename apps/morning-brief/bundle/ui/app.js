import { mountMorningBrief } from './view.js'

// The installed host supplies the public document-bound SDK. No fallback bridge.
mountMorningBrief({ document, window })
