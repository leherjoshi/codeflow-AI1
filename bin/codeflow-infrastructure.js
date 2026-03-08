#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const codeflow_infrastructure_stack_1 = require("../lib/codeflow-infrastructure-stack");
const app = new cdk.App();
// Get environment configuration from context or environment variables
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};
// Get environment name (dev, staging, prod)
const environmentName = app.node.tryGetContext('environment') || process.env.ENVIRONMENT || 'dev';
new codeflow_infrastructure_stack_1.CodeFlowInfrastructureStack(app, `CodeFlowInfrastructure-${environmentName}`, {
    env,
    environmentName,
    description: 'CodeFlow AI Platform - AWS Infrastructure Stack',
    tags: {
        Project: 'CodeFlow-AI',
        Environment: environmentName,
        ManagedBy: 'AWS-CDK',
    },
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWZsb3ctaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb2RlZmxvdy1pbmZyYXN0cnVjdHVyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx1Q0FBcUM7QUFDckMsaURBQW1DO0FBQ25DLHdGQUFtRjtBQUVuRixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQixzRUFBc0U7QUFDdEUsTUFBTSxHQUFHLEdBQUc7SUFDVixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQWM7SUFDdEUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyxVQUFVLElBQUksV0FBVztDQUNoRixDQUFDO0FBRUYsNENBQTRDO0FBQzVDLE1BQU0sZUFBZSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxHQUFHLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQztBQUVsRyxJQUFJLDJEQUEyQixDQUFDLEdBQUcsRUFBRSwwQkFBMEIsZUFBZSxFQUFFLEVBQUU7SUFDaEYsR0FBRztJQUNILGVBQWU7SUFDZixXQUFXLEVBQUUsaURBQWlEO0lBQzlELElBQUksRUFBRTtRQUNKLE9BQU8sRUFBRSxhQUFhO1FBQ3RCLFdBQVcsRUFBRSxlQUFlO1FBQzVCLFNBQVMsRUFBRSxTQUFTO0tBQ3JCO0NBQ0YsQ0FBQyxDQUFDO0FBRUgsR0FBRyxDQUFDLEtBQUssRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICdzb3VyY2UtbWFwLXN1cHBvcnQvcmVnaXN0ZXInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvZGVGbG93SW5mcmFzdHJ1Y3R1cmVTdGFjayB9IGZyb20gJy4uL2xpYi9jb2RlZmxvdy1pbmZyYXN0cnVjdHVyZS1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIEdldCBlbnZpcm9ubWVudCBjb25maWd1cmF0aW9uIGZyb20gY29udGV4dCBvciBlbnZpcm9ubWVudCB2YXJpYWJsZXNcbmNvbnN0IGVudiA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCB8fCBwcm9jZXNzLmVudi5BV1NfQUNDT1VOVF9JRCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gfHwgcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJyxcbn07XG5cbi8vIEdldCBlbnZpcm9ubWVudCBuYW1lIChkZXYsIHN0YWdpbmcsIHByb2QpXG5jb25zdCBlbnZpcm9ubWVudE5hbWUgPSBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIHx8IHByb2Nlc3MuZW52LkVOVklST05NRU5UIHx8ICdkZXYnO1xuXG5uZXcgQ29kZUZsb3dJbmZyYXN0cnVjdHVyZVN0YWNrKGFwcCwgYENvZGVGbG93SW5mcmFzdHJ1Y3R1cmUtJHtlbnZpcm9ubWVudE5hbWV9YCwge1xuICBlbnYsXG4gIGVudmlyb25tZW50TmFtZSxcbiAgZGVzY3JpcHRpb246ICdDb2RlRmxvdyBBSSBQbGF0Zm9ybSAtIEFXUyBJbmZyYXN0cnVjdHVyZSBTdGFjaycsXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiAnQ29kZUZsb3ctQUknLFxuICAgIEVudmlyb25tZW50OiBlbnZpcm9ubWVudE5hbWUsXG4gICAgTWFuYWdlZEJ5OiAnQVdTLUNESycsXG4gIH0sXG59KTtcblxuYXBwLnN5bnRoKCk7XG4iXX0=