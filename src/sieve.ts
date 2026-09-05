const BEGIN_MARKER = "# GRAYMAIL-BEGIN";
const END_MARKER = "# GRAYMAIL-END";

interface GraymailAddresses {
  exact: string[];
  domains: string[];
}

function parseSieveBlock(block: string): GraymailAddresses {
  const result: GraymailAddresses = { exact: [], domains: [] };

  const exactMatch = block.match(
    /address\s+:all\s+:is\s+"from"\s+\[([\s\S]*?)\]/,
  );
  if (exactMatch) {
    for (const m of exactMatch[1].matchAll(/"([^"]+)"/g)) {
      result.exact.push(m[1].toLowerCase());
    }
  }

  const domainMatch = block.match(
    /address\s+:domain\s+:is\s+"from"\s+\[([\s\S]*?)\]/,
  );
  if (domainMatch) {
    for (const m of domainMatch[1].matchAll(/"([^"]+)"/g)) {
      result.domains.push(m[1].toLowerCase());
    }
  }

  return result;
}

function generateSieveBlock(
  addrs: GraymailAddresses,
  folder: string,
): string {
  if (addrs.exact.length === 0 && addrs.domains.length === 0) {
    return `${BEGIN_MARKER}\n${END_MARKER}`;
  }

  const needsAnyof =
    addrs.exact.length > 0 && addrs.domains.length > 0;
  const indent = needsAnyof ? "    " : "  ";
  const closingIndent = needsAnyof ? "  " : "";

  const conditions: string[] = [];

  if (addrs.exact.length > 0) {
    const list = addrs.exact.map((a) => `${indent}"${a}"`).join(",\n");
    conditions.push(
      `  address :all :is "from" [\n${list}\n${closingIndent}]`,
    );
  }

  if (addrs.domains.length > 0) {
    const list = addrs.domains.map((d) => `${indent}"${d}"`).join(",\n");
    conditions.push(
      `  address :domain :is "from" [\n${list}\n${closingIndent}]`,
    );
  }

  let test: string;
  if (needsAnyof) {
    test = `anyof (\n${conditions.join(",\n")}\n)`;
  } else {
    test = conditions[0].trimStart();
  }

  return [
    BEGIN_MARKER,
    `if ${test} {`,
    `  fileinto :create "${folder}";`,
    "  stop;",
    "}",
    END_MARKER,
  ].join("\n");
}

export function updateSieveScript(
  script: string,
  newAddresses: string[],
  folder: string,
): string {
  const beginIdx = script.indexOf(BEGIN_MARKER);
  const endIdx = script.indexOf(END_MARKER);

  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `Sieve script is missing ${BEGIN_MARKER} / ${END_MARKER} markers`,
    );
  }

  const endMarkerEnd = endIdx + END_MARKER.length;
  const block = script.substring(beginIdx, endMarkerEnd);

  const addrs = parseSieveBlock(block);

  const existingSet = new Set(addrs.exact);
  let changed = false;
  for (const addr of newAddresses) {
    const lower = addr.toLowerCase();
    if (!existingSet.has(lower)) {
      addrs.exact.push(lower);
      existingSet.add(lower);
      changed = true;
    }
  }

  if (!changed) return script;

  const newBlock = generateSieveBlock(addrs, folder);
  return script.substring(0, beginIdx) + newBlock + script.substring(endMarkerEnd);
}
