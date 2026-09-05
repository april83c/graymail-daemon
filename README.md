# graymail-daemon

Automatically manages graymail (newsletters, notifications, bulk email) by learning from your sorting behavior.

## How it works

1. Move an unwanted email into the `Graymail/Add` IMAP folder
2. The daemon picks it up, adds the sender to your ManageSieve filter
3. Future emails from that sender are automatically sorted to `Graymail`
4. Existing emails from that sender in your inbox are moved to `Graymail` too

## Setup

### 1. Set up your sieve script

Add this to your sieve script (via Roundcube, your mail panel, etc.). The daemon only modifies the section between the `# GRAYMAIL-BEGIN` and `# GRAYMAIL-END` markers — everything else is yours.

```sieve
require ["fileinto", "mailbox"];

# Catch common bulk mail patterns
if anyof (
  exists "List-Unsubscribe",
  exists "Auto-Submitted",
  header :is "Precedence" ["bulk", "list", "junk"]
) {
  fileinto :create "Graymail";
  stop;
}

# GRAYMAIL-BEGIN
# GRAYMAIL-END
```

You can pre-populate the managed section with addresses or domains:

```sieve
# GRAYMAIL-BEGIN
if anyof (
  address :all :is "from" [
    "noreply@example.com",
    "hello@somestartup.io"
  ],
  address :domain :is "from" [
    "mailer.vendor.net"
  ]
) {
  fileinto :create "Graymail";
  stop;
}
# GRAYMAIL-END
```

The daemon adds individual sender addresses (`address :all :is "from"`) and preserves any domain rules (`address :domain :is "from"`) you add manually.

### 2. Create the IMAP folders

Create two folders in your mail client:

- **Graymail** — where graymail is delivered
- **Graymail/Add** — drop emails here to train the filter

### 3. Configure

Copy `.env.example` to `.env` and fill in your values:

```sh
cp .env.example .env
```

| Variable | Required | Default | Description |
|---|---|---|---|
| `IMAP_HOST` | yes | | IMAP server hostname |
| `IMAP_PORT` | | `993` | IMAP port |
| `IMAP_TLS` | | `true` | Use TLS for IMAP (`true` for port 993) |
| `SIEVE_HOST` | yes | | ManageSieve server hostname |
| `SIEVE_PORT` | | `4190` | ManageSieve port |
| `SIEVE_SECURITY` | | `starttls` | `starttls`, `tls`, or `none` |
| `SIEVE_SCRIPT_NAME` | | `roundcube` | Name of the sieve script to manage |
| `MAIL_USER` | yes | | Email account username |
| `MAIL_PASS` | yes | | Email account password |
| `POLL_INTERVAL_SECONDS` | | `300` | How often to check (seconds) |
| `GRAYMAIL_FOLDER` | | `Graymail` | Destination folder |
| `GRAYMAIL_ADD_FOLDER` | | `Graymail/Add` | Folder to watch |
| `INBOX_FOLDER` | | `INBOX` | Inbox folder name |

### 4. Run

```sh
docker compose up -d
```

## Development

```sh
bun install
bun run start
bun run check  # type-check
```
