/**
 * OneDriveConnector
 * -----------------
 * Fetches file listings and metadata from Microsoft OneDrive via the
 * Microsoft Graph API. Requires a valid delegated access token with at
 * least Files.Read scope.
 *
 * Design rules (from CLAUDE.md):
 *   - Graph API only — no browser automation.
 *   - Does NOT auto-index or auto-write. Returns raw item metadata
 *     for the caller to queue for human-approved ingestion.
 *   - The access token is passed per-call so nothing is stored at rest.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface OneDriveItem {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  webUrl: string;
  /** Present on files (absent on folders). */
  file?: { mimeType: string };
  /** Present on folders. */
  folder?: { childCount: number };
  /** @microsoft.graph.downloadUrl — pre-authenticated short-lived URL. */
  downloadUrl?: string;
}

export interface OneDriveListing {
  driveId: string;
  folderId: string | null;
  items: OneDriveItem[];
  nextLink?: string;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class OneDriveConnector {
  private fetch: FetchFn;

  constructor(
    private accessToken: string,
    fetchImpl?: FetchFn
  ) {
    // Allow injecting a mock fetch in tests; default to globalThis.fetch (Node 18+).
    this.fetch = fetchImpl ?? ((url, init) => globalThis.fetch(url, init));
  }

  private authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${this.accessToken}` };
  }

  /**
   * List children of a OneDrive folder.
   * @param driveId  'me' for the signed-in user's drive, or a shared drive ID.
   * @param folderId  Item ID of the folder, or null/'' for the root.
   * @param top       Page size (default 50, max 1000).
   */
  async listItems(driveId: string, folderId: string | null, top = 50): Promise<OneDriveListing> {
    const base = folderId
      ? `${GRAPH_BASE}/drives/${driveId}/items/${folderId}/children`
      : `${GRAPH_BASE}/drives/${driveId}/root/children`;
    const url = `${base}?$top=${top}&$select=id,name,size,lastModifiedDateTime,webUrl,file,folder,@microsoft.graph.downloadUrl`;

    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph API error ${res.status}: ${text}`);
    }
    const json = await res.json() as { value: OneDriveItem[]; "@odata.nextLink"?: string };
    return {
      driveId,
      folderId: folderId ?? null,
      items: json.value,
      nextLink: json["@odata.nextLink"],
    };
  }

  /**
   * Get a single item by ID.
   */
  async getItem(driveId: string, itemId: string): Promise<OneDriveItem> {
    const url = `${GRAPH_BASE}/drives/${driveId}/items/${itemId}?$select=id,name,size,lastModifiedDateTime,webUrl,file,folder,@microsoft.graph.downloadUrl`;
    const res = await this.fetch(url, { headers: this.authHeaders() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<OneDriveItem>;
  }

  /**
   * List all items in a folder recursively, up to maxDepth levels.
   * Returns a flat array of file items only (folders are traversed but not returned).
   */
  async listFilesRecursive(driveId: string, folderId: string | null, maxDepth = 3): Promise<OneDriveItem[]> {
    const files: OneDriveItem[] = [];
    const stack: { id: string | null; depth: number }[] = [{ id: folderId, depth: 0 }];

    while (stack.length) {
      const { id, depth } = stack.pop()!;
      const listing = await this.listItems(driveId, id);
      for (const item of listing.items) {
        if (item.file) {
          files.push(item);
        } else if (item.folder && depth < maxDepth) {
          stack.push({ id: item.id, depth: depth + 1 });
        }
      }
    }
    return files;
  }
}
