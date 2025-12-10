/**
 * @fileoverview Unit tests for Job type definitions and validation functions
 * @module types/Job.test
 */

import {
  isValidJobTaskType,
  validateBulkArticlesData,
  validateBulkProductsData,
  validateDesignBatchData,
  validateTaskData,
  estimateProcessingTime,
  MAX_BULK_ITEMS,
} from "./Job";

describe("Job Types", () => {
  describe("isValidJobTaskType", () => {
    it("should return true for bulk_articles", () => {
      expect(isValidJobTaskType("bulk_articles")).toBe(true);
    });

    it("should return true for bulk_products", () => {
      expect(isValidJobTaskType("bulk_products")).toBe(true);
    });

    it("should return true for design_batch", () => {
      expect(isValidJobTaskType("design_batch")).toBe(true);
    });

    it("should return false for invalid task types", () => {
      expect(isValidJobTaskType("invalid")).toBe(false);
      expect(isValidJobTaskType("TEXT_GEN")).toBe(false);
      expect(isValidJobTaskType("")).toBe(false);
    });
  });

  describe("validateBulkArticlesData", () => {
    it("should return valid for proper task data", () => {
      const result = validateBulkArticlesData({
        topics: ["Topic 1", "Topic 2"],
        tone: "professional",
        language: "en",
      });
      expect(result.valid).toBe(true);
    });

    it("should return invalid if data is not an object", () => {
      expect(validateBulkArticlesData(null).valid).toBe(false);
      expect(validateBulkArticlesData("string").valid).toBe(false);
      expect(validateBulkArticlesData(undefined).valid).toBe(false);
    });

    it("should return invalid if topics is not an array", () => {
      const result = validateBulkArticlesData({ topics: "not an array" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("topics must be an array");
    });

    it("should return invalid if topics is empty", () => {
      const result = validateBulkArticlesData({ topics: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("topics array cannot be empty");
    });

    it("should return invalid if topics exceeds max limit", () => {
      const topics = Array(MAX_BULK_ITEMS + 1).fill("topic");
      const result = validateBulkArticlesData({ topics });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Maximum");
    });

    it("should return invalid if topic is not a string", () => {
      const result = validateBulkArticlesData({ topics: [123, "valid"] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each topic must be a non-empty string");
    });

    it("should return invalid if topic is empty string", () => {
      const result = validateBulkArticlesData({ topics: ["", "valid"] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each topic must be a non-empty string");
    });

    it("should return invalid for invalid tone", () => {
      const result = validateBulkArticlesData({
        topics: ["Topic"],
        tone: "invalid_tone",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Invalid tone value");
    });

    it("should accept valid tone values", () => {
      expect(validateBulkArticlesData({ topics: ["T"], tone: "professional" }).valid).toBe(true);
      expect(validateBulkArticlesData({ topics: ["T"], tone: "casual" }).valid).toBe(true);
      expect(validateBulkArticlesData({ topics: ["T"], tone: "technical" }).valid).toBe(true);
      expect(validateBulkArticlesData({ topics: ["T"], tone: "friendly" }).valid).toBe(true);
    });

    it("should validate word_count range", () => {
      expect(validateBulkArticlesData({ topics: ["T"], word_count: 50 }).valid).toBe(false);
      expect(validateBulkArticlesData({ topics: ["T"], word_count: 100 }).valid).toBe(true);
      expect(validateBulkArticlesData({ topics: ["T"], word_count: 5000 }).valid).toBe(true);
      expect(validateBulkArticlesData({ topics: ["T"], word_count: 5001 }).valid).toBe(false);
    });
  });

  describe("validateBulkProductsData", () => {
    it("should return valid for proper task data", () => {
      const result = validateBulkProductsData({
        products: [
          { name: "Product 1", category: "Electronics" },
          { name: "Product 2" },
        ],
        language: "en",
      });
      expect(result.valid).toBe(true);
    });

    it("should return invalid if data is not an object", () => {
      expect(validateBulkProductsData(null).valid).toBe(false);
    });

    it("should return invalid if products is not an array", () => {
      const result = validateBulkProductsData({ products: "not an array" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("products must be an array");
    });

    it("should return invalid if products is empty", () => {
      const result = validateBulkProductsData({ products: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("products array cannot be empty");
    });

    it("should return invalid if products exceeds max limit", () => {
      const products = Array(MAX_BULK_ITEMS + 1).fill({ name: "Product" });
      const result = validateBulkProductsData({ products });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Maximum");
    });

    it("should return invalid if product is not an object", () => {
      const result = validateBulkProductsData({ products: ["not an object"] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each product must be an object");
    });

    it("should return invalid if product name is missing", () => {
      const result = validateBulkProductsData({ products: [{ category: "Test" }] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each product must have a non-empty name");
    });

    it("should return invalid if product name is empty", () => {
      const result = validateBulkProductsData({ products: [{ name: "" }] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each product must have a non-empty name");
    });
  });

  describe("validateDesignBatchData", () => {
    it("should return valid for proper task data", () => {
      const result = validateDesignBatchData({
        sections: [
          { name: "Hero", description: "Hero section" },
          { name: "Features", description: "Features section" },
        ],
      });
      expect(result.valid).toBe(true);
    });

    it("should return invalid if data is not an object", () => {
      expect(validateDesignBatchData(null).valid).toBe(false);
    });

    it("should return invalid if sections is not an array", () => {
      const result = validateDesignBatchData({ sections: "not an array" });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("sections must be an array");
    });

    it("should return invalid if sections is empty", () => {
      const result = validateDesignBatchData({ sections: [] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("sections array cannot be empty");
    });

    it("should return invalid if sections exceeds max limit", () => {
      const sections = Array(MAX_BULK_ITEMS + 1).fill({ name: "Section", description: "Desc" });
      const result = validateDesignBatchData({ sections });
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Maximum");
    });

    it("should return invalid if section is not an object", () => {
      const result = validateDesignBatchData({ sections: ["not an object"] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each section must be an object");
    });

    it("should return invalid if section name is missing", () => {
      const result = validateDesignBatchData({ sections: [{ description: "Desc" }] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each section must have a non-empty name");
    });

    it("should return invalid if section description is missing", () => {
      const result = validateDesignBatchData({ sections: [{ name: "Hero" }] });
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Each section must have a non-empty description");
    });
  });

  describe("validateTaskData", () => {
    it("should route to correct validator based on task type", () => {
      expect(validateTaskData("bulk_articles", { topics: ["T"] }).valid).toBe(true);
      expect(validateTaskData("bulk_products", { products: [{ name: "P" }] }).valid).toBe(true);
      expect(validateTaskData("design_batch", { sections: [{ name: "S", description: "D" }] }).valid).toBe(true);
    });

    it("should return invalid for unknown task type", () => {
      const result = validateTaskData("unknown" as never, {});
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown task type");
    });
  });

  describe("estimateProcessingTime", () => {
    it("should estimate time for bulk_articles", () => {
      // Base 5s + 15s per article
      expect(estimateProcessingTime("bulk_articles", 1)).toBe(20);
      expect(estimateProcessingTime("bulk_articles", 5)).toBe(80);
      expect(estimateProcessingTime("bulk_articles", 10)).toBe(155);
    });

    it("should estimate time for bulk_products", () => {
      // Base 5s + 10s per product
      expect(estimateProcessingTime("bulk_products", 1)).toBe(15);
      expect(estimateProcessingTime("bulk_products", 5)).toBe(55);
    });

    it("should estimate time for design_batch", () => {
      // Base 5s + 20s per section
      expect(estimateProcessingTime("design_batch", 1)).toBe(25);
      expect(estimateProcessingTime("design_batch", 3)).toBe(65);
    });

    it("should return base time for 0 items", () => {
      expect(estimateProcessingTime("bulk_articles", 0)).toBe(5);
    });
  });
});
