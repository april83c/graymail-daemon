import { ImapFlow } from "imapflow";
import { config } from "./config";
import { SieveClient } from "./sieve-client";
import { updateSieveScript } from "./sieve";

async function tick(): Promise<void> {
  console.log("[tick] Checking for new graymail senders...");

  const imap = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.mail.user,
      pass: config.mail.pass,
    },
    logger: false,
  });

  try {
    await imap.connect();

    const senders = new Set<string>();

    // Check Graymail/Add for messages
    let lock = await imap.getMailboxLock(config.graymailAddFolder);
    try {
      if (!imap.mailbox || imap.mailbox.exists === 0) {
        console.log("[tick] No messages in Graymail/Add");
        return;
      }

      for await (const msg of imap.fetch("1:*", { envelope: true })) {
        const addr = msg.envelope?.from?.[0]?.address?.toLowerCase();
        if (addr) senders.add(addr);
      }

      if (senders.size === 0) {
        console.log("[tick] No valid senders found");
        return;
      }

      console.log(
        `[tick] Found ${senders.size} sender(s): ${[...senders].join(", ")}`,
      );

      await imap.messageMove("1:*", config.graymailFolder);
      console.log("[tick] Moved messages from Graymail/Add to Graymail");
    } finally {
      lock.release();
    }

    // Update sieve filter
    const sieve = new SieveClient();
    try {
      await sieve.connect(
        config.sieve.host,
        config.sieve.port,
        config.sieve.security,
      );
      await sieve.authenticate(config.mail.user, config.mail.pass);

      const script = await sieve.getScript(config.sieve.scriptName);
      const updated = updateSieveScript(
        script,
        [...senders],
        config.graymailFolder,
      );

      if (updated !== script) {
        await sieve.putScript(config.sieve.scriptName, updated);
        console.log("[tick] Updated sieve script");
      } else {
        console.log("[tick] Sieve script already up to date");
      }

      await sieve.logout();
    } catch (err) {
      console.error("[tick] Sieve error:", err);
      sieve.destroy();
    }

    // Move existing inbox messages from those senders
    lock = await imap.getMailboxLock(config.inboxFolder);
    try {
      for (const sender of senders) {
        const found = await imap.search({ from: sender });
        if (!found || found.length === 0) continue;

        // IMAP SEARCH FROM is a substring match, so verify exact address
        const toMove: number[] = [];
        for await (const msg of imap.fetch(found, { envelope: true })) {
          if (msg.envelope?.from?.[0]?.address?.toLowerCase() === sender) {
            toMove.push(msg.uid);
          }
        }

        if (toMove.length > 0) {
          await imap.messageMove(toMove, config.graymailFolder, {
            uid: true,
          });
          console.log(
            `[tick] Moved ${toMove.length} message(s) from ${sender} in INBOX to Graymail`,
          );
        }
      }
    } finally {
      lock.release();
    }

    await imap.logout();
  } catch (err) {
    console.error("[tick] Error:", err);
    imap.close();
  }
}

async function main(): Promise<void> {
  console.log("graymail-daemon starting");
  console.log(`  IMAP: ${config.imap.host}:${config.imap.port}`);
  console.log(`  Sieve: ${config.sieve.host}:${config.sieve.port}`);
  console.log(`  Poll interval: ${config.pollIntervalSeconds}s`);
  console.log(`  Watching: ${config.graymailAddFolder}`);

  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error("Unhandled error:", err);
    }

    await Bun.sleep(config.pollIntervalSeconds * 1000);
  }
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down");
  process.exit(0);
});

main();
