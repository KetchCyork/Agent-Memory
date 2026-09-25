import assert from "node:assert/strict";
import { OneDriveConnector, type OneDriveItem, type FetchFn } from "../src/connectors/onedrive.js";

function makeItem(overrides: Partial<OneDriveItem> = {}): OneDriveItem {
  return {
    id: "item-1",
    name: "document.docx",
    size: 1024,
    lastModifiedDateTime: "2026-06-01T12:00:00Z",
    webUrl: "https://onedrive.example.com/item-1",
    file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ...overrides,
  };
}

function mockFetch(responses: Map<string, { ok: boolean; body: unknown }>): FetchFn {
  return async (url: string) => {
    const key = url.split("?")[0];
    const match = responses.get(key);
    if (!match) throw new Error(`Unexpected fetch: ${url}`);
    return {
      ok: match.ok,
      status: match.ok ? 200 : 400,
      text: async () => JSON.stringify(match.body),
      json: async () => match.body,
    } as Response;
  };
}

export async function runOneDriveTests(): Promise<void> {
  console.log("  [onedrive] running...");

  const driveId = "me";
  const folderId = "folder-abc";
  const items: OneDriveItem[] = [
    makeItem({ id: "f1", name: "proposal.docx" }),
    makeItem({ id: "f2", name: "budget.xlsx", file: { mimeType: "application/vnd.ms-excel" } }),
    { id: "fold1", name: "Archive", size: 0, lastModifiedDateTime: "2026-01-01T00:00:00Z", webUrl: "https://x", folder: { childCount: 3 } },
  ];

  const responses = new Map([
    [
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children`,
      { ok: true, body: { value: items } },
    ],
    [
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/f1`,
      { ok: true, body: items[0] },
    ],
    // For recursive listing: root listing returns a folder + files
    [
      `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`,
      { ok: true, body: { value: items } },
    ],
    // The folder child listing returns only files
    [
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/fold1/children`,
      { ok: true, body: { value: [makeItem({ id: "f3", name: "old.docx" })] } },
    ],
  ]);

  const connector = new OneDriveConnector("fake-token", mockFetch(responses));

  // listItems with folderId
  const listing = await connector.listItems(driveId, folderId);
  assert.equal(listing.driveId, driveId);
  assert.equal(listing.folderId, folderId);
  assert.equal(listing.items.length, 3);
  assert.equal(listing.items[0].name, "proposal.docx");

  // listItems with null folderId (root)
  const rootListing = await connector.listItems(driveId, null);
  assert.equal(rootListing.folderId, null);
  assert.equal(rootListing.items.length, 3);

  // getItem
  const item = await connector.getItem(driveId, "f1");
  assert.equal(item.name, "proposal.docx");

  // listFilesRecursive: root has 2 files + 1 folder; folder has 1 file → total 3
  const allFiles = await connector.listFilesRecursive(driveId, null);
  assert.equal(allFiles.length, 3);
  assert.ok(allFiles.every((f) => f.file)); // only files, no folders
  assert.ok(allFiles.some((f) => f.name === "old.docx")); // from subfolder

  // error response throws
  const errResponses = new Map([
    [
      `https://graph.microsoft.com/v1.0/drives/bad-drive/items/x/children`,
      { ok: false, body: { error: { code: "itemNotFound" } } },
    ],
  ]);
  const errConnector = new OneDriveConnector("fake-token", mockFetch(errResponses));
  await assert.rejects(
    () => errConnector.listItems("bad-drive", "x"),
    /Graph API error 400/
  );

  console.log("  [onedrive] all tests passed");
}
