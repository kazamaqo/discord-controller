# Architecture rules
- Discord chat commands are handled in the shared command listener and restricted to the primary account's own messages, so multiple connected clients cannot duplicate command actions.
- Voice join commands reuse each account's MusicManager instead of creating separate connections, so reconnect behavior remains shared with dashboard joins.
- Command tests exercise the actual listener using Node's test runner with injected Discord/voice dependencies, so command behavior can be verified without credentials.