import { describe, expect, it } from "vitest";
import { getImageUrl } from "../ExternalImage";

describe("getImageUrl", () => {
  describe("when URL has an image extension", () => {
    it("accepts https URL with .png extension", () => {
      expect(getImageUrl("https://example.com/image.png")).toBe(
        "https://example.com/image.png",
      );
    });

    it("accepts https URL with .jpg extension and query string", () => {
      expect(getImageUrl("https://example.com/photo.jpg?size=large")).toBe(
        "https://example.com/photo.jpg?size=large",
      );
    });
  });

  describe("when URL is a markdown image", () => {
    it("extracts URL from markdown image syntax", () => {
      expect(getImageUrl("![alt text](https://example.com/img.png)")).toBe(
        "https://example.com/img.png",
      );
    });
  });

  describe("when URL is a base64 data URI", () => {
    it("accepts valid base64 image data URI", () => {
      const dataUri = "data:image/png;base64,abc123";
      expect(getImageUrl(dataUri)).toBe(dataUri);
    });

    it("rejects data URI with disallowed mime type", () => {
      expect(getImageUrl("data:text/html;base64,abc123")).toBeNull();
    });
  });

  describe("when URL is from a known Google image host", () => {
    it("accepts subdomains of gstatic.com", () => {
      expect(
        getImageUrl("https://lh3.googleusercontent.com/some/path/to/image"),
      ).toBe("https://lh3.googleusercontent.com/some/path/to/image");
    });

    it("accepts subdomains of googleusercontent.com", () => {
      expect(
        getImageUrl("https://encrypted-tbn0.gstatic.com/images?q=some-hash"),
      ).toBe("https://encrypted-tbn0.gstatic.com/images?q=some-hash");
    });

    it("rejects domains that merely end with gstatic.com but are not subdomains", () => {
      expect(getImageUrl("https://evil-gstatic.com/image.php")).toBeNull();
    });

    it("rejects domains that merely end with googleusercontent.com but are not subdomains", () => {
      expect(
        getImageUrl("https://evil-googleusercontent.com/image.php"),
      ).toBeNull();
    });
  });

  describe("when input is invalid", () => {
    it("returns null for non-URL strings", () => {
      expect(getImageUrl("not a url")).toBeNull();
    });

    it("returns null for null", () => {
      expect(getImageUrl(null)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(getImageUrl("")).toBeNull();
    });
  });
});
