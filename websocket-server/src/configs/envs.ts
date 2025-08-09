import dotenv from "dotenv";

const NODE_ENV = process.env.NODE_ENV || "development";
dotenv.config({ path: `.env.${NODE_ENV}` });
dotenv.config();

const requiredEnvs: {
  OPENAI_API_KEY: string;
} = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
};


for (const [key, value] of Object.entries(requiredEnvs)) {
  if (!value) {
    console.error(`❌ Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

export const envs: {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  PORT: string | number;
  HOST: string;
  PUBLIC_URL: string;
  IS_PRODUCTION: boolean;
  IS_DEVELOPMENT: boolean;
  WS_HEARTBEAT_INTERVAL: string | number;
  MAX_RECONNECT_ATTEMPTS: string | number;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  CALENDLY_ACCESS_TOKEN: string;
} = {

  OPENAI_API_KEY: requiredEnvs.OPENAI_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL || "gpt-4o-realtime-preview-2024-12-17",


  PORT: process.env.PORT || 8081,
  HOST: process.env.HOST || "localhost",
  PUBLIC_URL: process.env.PUBLIC_URL || `http://${process.env.HOST || "localhost"}:${process.env.PORT || 8081}`,


  IS_PRODUCTION: NODE_ENV === "production",
  IS_DEVELOPMENT: NODE_ENV === "development",


  WS_HEARTBEAT_INTERVAL: process.env.WS_HEARTBEAT_INTERVAL || 30000,
  MAX_RECONNECT_ATTEMPTS: process.env.MAX_RECONNECT_ATTEMPTS || 3,



  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",


  CALENDLY_ACCESS_TOKEN: process.env.CALENDLY_ACCESS_TOKEN || "",

};

