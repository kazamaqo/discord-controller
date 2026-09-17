import { v4 as uuidv4 } from "uuid";

// Discord can only render presence images that it can fetch itself, so gallery
// picks (data: URLs) are stored here and served from a public /uploads/:id URL.
interface StoredImage {
  data: Buffer;
  contentType: string;
  createdAt: number;
}

const MAX_BYTES = 8 * 1024 * 1024; // 8MB per image
const MAX_IMAGES = 40;

const images = new Map<string, StoredImage>();

export function storeDataUrl(dataUrl: string): { id: string; contentType: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a base64 image data URL");
  const contentType = match[1]!;
  const data = Buffer.from(match[2]!, "base64");
  if (!data.length) throw new Error("Image is empty");
  if (data.length > MAX_BYTES) throw new Error("Image is larger than 8MB");

  const id = `${uuidv4()}${extensionFor(contentType)}`;
  images.set(id, { data, contentType, createdAt: Date.now() });

  // Keep only the most recent uploads; presence only ever uses the latest ones.
  while (images.size > MAX_IMAGES) {
    const oldest = images.keys().next();
    if (oldest.done) break;
    images.delete(oldest.value);
  }

  return { id, contentType };
}

export function getImage(id: string): StoredImage | undefined {
  return images.get(id);
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  if (contentType === "image/gif") return ".gif";
  return ".jpg";
}
