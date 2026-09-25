import { config } from "dotenv";

// Local runs read .env.local; in CI the variables come from the environment.
config({ path: ".env.local", quiet: true });
