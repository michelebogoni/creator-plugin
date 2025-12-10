/**
 * @fileoverview Script to seed admin license in Firestore
 * @module scripts/seedAdminLicense
 *
 * Run with: npx ts-node src/scripts/seedAdminLicense.ts
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Admin license configuration
 */
const ADMIN_LICENSE = {
  license_key: "CREATOR-2025-ADMIN-ADMIN",
  site_url: "https://micheleb174.sg-host.com",
  user_id: "admin_michele",
  plan: "enterprise" as const,
  tokens_limit: Number.MAX_SAFE_INTEGER, // ~9 quadrillion tokens
  tokens_used: 0,
  status: "active" as const,
  reset_date: Timestamp.fromDate(new Date("2124-12-31")), // 100 years from now
  expires_at: Timestamp.fromDate(new Date("2124-12-31")), // 100 years from now
  created_at: Timestamp.now(),
  updated_at: Timestamp.now(),
};

/**
 * Seeds the admin license into Firestore
 */
async function seedAdminLicense(): Promise<void> {
  console.log("🔑 Seeding admin license...");
  console.log(`   License Key: ${ADMIN_LICENSE.license_key}`);
  console.log(`   Site URL: ${ADMIN_LICENSE.site_url}`);
  console.log(`   Plan: ${ADMIN_LICENSE.plan}`);
  console.log(`   Tokens Limit: ${ADMIN_LICENSE.tokens_limit.toLocaleString()}`);
  console.log(`   Expires: ${ADMIN_LICENSE.expires_at.toDate().toISOString()}`);

  try {
    const docRef = db.collection("licenses").doc(ADMIN_LICENSE.license_key);

    // Check if already exists
    const existing = await docRef.get();
    if (existing.exists) {
      console.log("\n⚠️  License already exists. Updating...");
      await docRef.update({
        ...ADMIN_LICENSE,
        updated_at: Timestamp.now(),
        // Preserve existing site_token if present
        site_token: existing.data()?.site_token || null,
      });
      console.log("✅ Admin license updated successfully!");
    } else {
      await docRef.set(ADMIN_LICENSE);
      console.log("\n✅ Admin license created successfully!");
    }

    // Verify
    const verification = await docRef.get();
    console.log("\n📋 Verification:");
    console.log(JSON.stringify(verification.data(), null, 2));
  } catch (error) {
    console.error("❌ Error seeding admin license:", error);
    throw error;
  }
}

// Run if executed directly
seedAdminLicense()
  .then(() => {
    console.log("\n🎉 Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });

export { seedAdminLicense, ADMIN_LICENSE };
