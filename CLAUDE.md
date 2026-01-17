# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pingaholic is a network monitoring application that uses ICMP ping to track device availability on a local network. The project has a humorous "drinking buddy" theme reflected in naming conventions and logging.

## Development Commands

```bash
# Install dependencies
npm install

# Start production server (port 8000)
npm start

# Start development server with auto-reload
npm run dev
```

The development server uses nodemon with special configuration:
- Ignores changes to `db/*.db` and `db/network_monitor.db`
- Has a 1000ms delay before restarting

## Architecture Overview

### Backend Structure

**Entry Point**: `server.js`
- Express server on port 8000 (or PORT env var)
- Initializes database and starts ping service on startup
- Serves static files from `public/`
- API routes mounted at `/api`

**Database Layer**: `db/database.js`
- Uses SQLite3 with file at `db/network_monitor.db`
- Two tables:
  - `targets`: Stores monitored hosts (ip, name, added)
  - `ping_results`: Stores ping history (ip, alive, time, status, timestamp)
- Foreign key relationship with CASCADE delete (removing target deletes all its ping results)
- All database functions are async and ensure initialization before queries
- Initialization happens automatically on first connection

**Services**:

1. `services/ping.js` - Core ping monitoring service
   - Default 60-second ping interval
   - "Turbo mode" available (5-second interval)
   - Uses node-cron for scheduling: `*/${PING_INTERVAL} * * * * *`
   - Tracks timing: lastPingTime, nextPingTime for UI sync
   - Pings targets sequentially (not parallel)
   - Changing turbo mode stops existing cron job and reschedules

2. `services/discovery.js` - Network scanning
   - Scans CIDR ranges (e.g., "192.168.1.0/24")
   - Uses 100ms timeout for fast scanning
   - Generates random "drunken" hostnames for discovered devices
   - Not currently used directly (logic moved to routes/api.js)

**API Routes**: `routes/api.js`
- All routes under `/api` prefix
- Key endpoints:
  - `GET /targets` - List all monitored targets
  - `POST /targets` - Add target (auto-generates drunken hostname if name not provided)
  - `DELETE /targets/:ip` - Remove target
  - `GET /results/:ip` - Get ping history (default limit: 100)
  - `POST /ping` - Manually trigger ping of all targets
  - `POST /discover` - Network discovery with Server-Sent Events for progress
  - `GET /ping/status` - Get current ping cycle timing info
  - `POST /ping/turbo` - Toggle turbo mode (body: `{enabled: true/false}`)
  - `POST /targets/:ip/reset` - Clear ping history for a target
  - `GET /debug/database` - Database diagnostics
  - `POST /debug/reset-database` - Drop and recreate all tables

**Discovery State Management**:
- Global `isDiscoveryRunning` flag prevents concurrent scans
- Discovery endpoint uses custom JSON streaming (not true SSE)
- Progress updates sent as JSON objects with types: 'progress', 'host', 'complete', 'error'

**Hostname Generation**:
- Combines drinking-related adjectives with random animal nouns
- Format: `{adjective}_{noun}` (e.g., "tipsy_penguin", "sloshed_narwhal")
- Used for auto-naming targets and discovered hosts

### Frontend Structure

- `public/index.html` - Single-page application
- `public/js/app.js` - Frontend logic (Chart.js for graphs)
- `public/css/style.css` - Styling

## Key Implementation Details

### Database Initialization
The database auto-initializes on first connection. The `ensureInitialized()` helper ensures schema is ready before any query. Foreign keys are enabled via `PRAGMA foreign_keys = ON`.

### Ping Timing
The ping service tracks:
- `lastPingTime`: When the last ping cycle started
- `nextPingTime`: When the next ping is scheduled
- `PING_INTERVAL`: Current interval in seconds (60 default, 5 in turbo mode)

The `/ping/status` endpoint provides this timing info for UI synchronization.

### Cron Scheduling
The ping service uses node-cron with second-level precision. The pattern `*/${PING_INTERVAL} * * * * *` means "every N seconds". When changing modes, the old task is stopped and a new one is created.

### Error Handling
- All API endpoints wrap database/service calls in try-catch
- Errors logged with ISO timestamps: `[${new Date().toISOString()}]`
- Database functions use Promise wrappers around SQLite callbacks
- Ping failures return `{alive: false, time: null, status: 'red'}`

## Important Behaviors

1. **Target Uniqueness**: IP addresses are primary keys. Adding a duplicate IP returns 409 Conflict.

2. **Cascade Deletes**: Removing a target automatically deletes all its ping results via foreign key constraint.

3. **Sequential Pings**: Targets are pinged one at a time in a for-loop, not in parallel.

4. **Discovery vs Routes**: The `services/discovery.js` file exists but isn't used. Discovery logic is implemented directly in `routes/api.js` to support progress streaming.

5. **Ping Timeout**: Regular pings use 10s timeout, discovery scans use 0.1s timeout.

6. **Database Path**: `db/network_monitor.db` is the SQLite file. The `db/` directory is created automatically if missing.

7. **Nodemon Configuration**: Exists in both `package.json` (nodemonConfig) and `nodemon.json` (may conflict).
