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
exports.CodeFlowInfrastructureStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const opensearch = __importStar(require("aws-cdk-lib/aws-opensearchservice"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const sqs = __importStar(require("aws-cdk-lib/aws-sqs"));
const ecs = __importStar(require("aws-cdk-lib/aws-ecs"));
const ecr = __importStar(require("aws-cdk-lib/aws-ecr"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cloudwatch_actions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
class CodeFlowInfrastructureStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environmentName } = props;
        // ========================================
        // VPC Configuration
        // ========================================
        this.vpc = new ec2.Vpc(this, 'CodeFlowVPC', {
            vpcName: `codeflow-vpc-${environmentName}`,
            maxAzs: 2, // Use 2 availability zones for high availability
            natGateways: 1, // Cost optimization: 1 NAT Gateway (can increase for prod)
            // IP Address Configuration
            ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
            // Subnet Configuration
            subnetConfiguration: [
                {
                    name: 'Public',
                    subnetType: ec2.SubnetType.PUBLIC,
                    cidrMask: 24, // 10.0.0.0/24, 10.0.1.0/24
                    mapPublicIpOnLaunch: true,
                },
                {
                    name: 'Private',
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    cidrMask: 24, // 10.0.2.0/24, 10.0.3.0/24
                },
                {
                    name: 'Isolated',
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    cidrMask: 24, // 10.0.4.0/24, 10.0.5.0/24 (for databases)
                },
            ],
            // Enable DNS
            enableDnsHostnames: true,
            enableDnsSupport: true,
            // VPC Flow Logs for security monitoring
            flowLogs: {
                'CodeFlowVPCFlowLog': {
                    destination: ec2.FlowLogDestination.toCloudWatchLogs(new logs.LogGroup(this, 'VPCFlowLogGroup', {
                        logGroupName: `/aws/vpc/codeflow-${environmentName}`,
                        retention: logs.RetentionDays.ONE_WEEK,
                        removalPolicy: cdk.RemovalPolicy.DESTROY,
                    })),
                    trafficType: ec2.FlowLogTrafficType.ALL,
                },
            },
        });
        // Add tags to VPC
        cdk.Tags.of(this.vpc).add('Name', `codeflow-vpc-${environmentName}`);
        cdk.Tags.of(this.vpc).add('Environment', environmentName);
        // ========================================
        // Security Groups
        // ========================================
        // Lambda Security Group
        this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `codeflow-lambda-sg-${environmentName}`,
            description: 'Security group for Lambda functions',
            allowAllOutbound: true, // Lambda needs to call external APIs (LeetCode, Bedrock, etc.)
        });
        cdk.Tags.of(this.lambdaSecurityGroup).add('Name', `codeflow-lambda-sg-${environmentName}`);
        // OpenSearch Security Group
        this.openSearchSecurityGroup = new ec2.SecurityGroup(this, 'OpenSearchSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `codeflow-opensearch-sg-${environmentName}`,
            description: 'Security group for OpenSearch domain',
            allowAllOutbound: true,
        });
        // Allow Lambda to access OpenSearch on port 443 (HTTPS)
        this.openSearchSecurityGroup.addIngressRule(this.lambdaSecurityGroup, ec2.Port.tcp(443), 'Allow Lambda to access OpenSearch');
        cdk.Tags.of(this.openSearchSecurityGroup).add('Name', `codeflow-opensearch-sg-${environmentName}`);
        // ECS Fargate Security Group
        this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
            vpc: this.vpc,
            securityGroupName: `codeflow-ecs-sg-${environmentName}`,
            description: 'Security group for ECS Fargate tasks',
            allowAllOutbound: true, // ECS tasks need to call Bedrock, DynamoDB, S3
        });
        cdk.Tags.of(this.ecsSecurityGroup).add('Name', `codeflow-ecs-sg-${environmentName}`);
        // ========================================
        // VPC Endpoints (Cost Optimization)
        // ========================================
        // S3 Gateway Endpoint (Free - no data transfer charges within same region)
        this.vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [
                { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            ],
        });
        // DynamoDB Gateway Endpoint (Free)
        this.vpc.addGatewayEndpoint('DynamoDBEndpoint', {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
            subnets: [
                { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
                { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
            ],
        });
        // ========================================
        // DynamoDB Tables
        // ========================================
        // Users Table
        this.usersTable = new dynamodb.Table(this, 'UsersTable', {
            tableName: `codeflow-users-${environmentName}`,
            partitionKey: {
                name: 'user_id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });
        // Add GSI for leetcode_username lookup
        this.usersTable.addGlobalSecondaryIndex({
            indexName: 'leetcode-username-index',
            partitionKey: {
                name: 'leetcode_username',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        cdk.Tags.of(this.usersTable).add('Name', `codeflow-users-${environmentName}`);
        cdk.Tags.of(this.usersTable).add('Environment', environmentName);
        // LearningPaths Table
        this.learningPathsTable = new dynamodb.Table(this, 'LearningPathsTable', {
            tableName: `codeflow-learning-paths-${environmentName}`,
            partitionKey: {
                name: 'path_id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });
        // Add GSI for user_id lookup
        this.learningPathsTable.addGlobalSecondaryIndex({
            indexName: 'user-id-index',
            partitionKey: {
                name: 'user_id',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        cdk.Tags.of(this.learningPathsTable).add('Name', `codeflow-learning-paths-${environmentName}`);
        cdk.Tags.of(this.learningPathsTable).add('Environment', environmentName);
        // Progress Table
        this.progressTable = new dynamodb.Table(this, 'ProgressTable', {
            tableName: `codeflow-progress-${environmentName}`,
            partitionKey: {
                name: 'progress_id',
                type: dynamodb.AttributeType.STRING, // user_id#date format
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });
        // Add GSI for user_id lookup
        this.progressTable.addGlobalSecondaryIndex({
            indexName: 'user-id-index',
            partitionKey: {
                name: 'user_id',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        cdk.Tags.of(this.progressTable).add('Name', `codeflow-progress-${environmentName}`);
        cdk.Tags.of(this.progressTable).add('Environment', environmentName);
        // LLMCache Table with TTL
        this.llmCacheTable = new dynamodb.Table(this, 'LLMCacheTable', {
            tableName: `codeflow-llm-cache-${environmentName}`,
            partitionKey: {
                name: 'query_hash',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Cache can be recreated
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            timeToLiveAttribute: 'ttl', // TTL: 7 days
        });
        cdk.Tags.of(this.llmCacheTable).add('Name', `codeflow-llm-cache-${environmentName}`);
        cdk.Tags.of(this.llmCacheTable).add('Environment', environmentName);
        // ConversationHistory Table with TTL
        this.conversationHistoryTable = new dynamodb.Table(this, 'ConversationHistoryTable', {
            tableName: `codeflow-conversation-history-${environmentName}`,
            partitionKey: {
                name: 'user_id',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
            timeToLiveAttribute: 'ttl', // TTL: 90 days
        });
        cdk.Tags.of(this.conversationHistoryTable).add('Name', `codeflow-conversation-history-${environmentName}`);
        cdk.Tags.of(this.conversationHistoryTable).add('Environment', environmentName);
        // KnowledgeBase Table
        this.knowledgeBaseTable = new dynamodb.Table(this, 'KnowledgeBaseTable', {
            tableName: `codeflow-knowledge-base-${environmentName}`,
            partitionKey: {
                name: 'doc_id',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });
        // Add GSI for category-index
        this.knowledgeBaseTable.addGlobalSecondaryIndex({
            indexName: 'category-index',
            partitionKey: {
                name: 'category',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'subcategory',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        // Add GSI for complexity-index
        this.knowledgeBaseTable.addGlobalSecondaryIndex({
            indexName: 'complexity-index',
            partitionKey: {
                name: 'complexity',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'last_updated',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });
        cdk.Tags.of(this.knowledgeBaseTable).add('Name', `codeflow-knowledge-base-${environmentName}`);
        cdk.Tags.of(this.knowledgeBaseTable).add('Environment', environmentName);
        // Analytics Table
        this.analyticsTable = new dynamodb.Table(this, 'AnalyticsTable', {
            tableName: `codeflow-analytics-${environmentName}`,
            partitionKey: {
                name: 'date',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'metric_type',
                type: dynamodb.AttributeType.STRING,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
        });
        cdk.Tags.of(this.analyticsTable).add('Name', `codeflow-analytics-${environmentName}`);
        cdk.Tags.of(this.analyticsTable).add('Environment', environmentName);
        // InterviewSessions Table - Stores AI interview simulator session data
        this.interviewSessionsTable = new dynamodb.Table(this, 'InterviewSessionsTable', {
            tableName: `codeflow-interview-sessions-${environmentName}`,
            partitionKey: {
                name: 'session_id',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            timeToLiveAttribute: 'ttl',
        });
        // Add GSI for querying by user_id
        this.interviewSessionsTable.addGlobalSecondaryIndex({
            indexName: 'user-id-index',
            partitionKey: {
                name: 'user_id',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
        });
        // Add GSI for querying by interview_type
        this.interviewSessionsTable.addGlobalSecondaryIndex({
            indexName: 'interview-type-index',
            partitionKey: {
                name: 'interview_type',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'timestamp',
                type: dynamodb.AttributeType.NUMBER,
            },
        });
        cdk.Tags.of(this.interviewSessionsTable).add('Name', `codeflow-interview-sessions-${environmentName}`);
        cdk.Tags.of(this.interviewSessionsTable).add('Environment', environmentName);
        // ========================================
        // S3 Buckets
        // ========================================
        // Static Assets Bucket (React build artifacts, images, fonts, icons)
        this.staticAssetsBucket = new s3.Bucket(this, 'StaticAssetsBucket', {
            bucketName: `codeflow-static-assets-${environmentName}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: false,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            // Lifecycle policies: Transition to IA after 90 days
            lifecycleRules: [
                {
                    id: 'TransitionToIA',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(90),
                        },
                    ],
                },
            ],
            // CORS configuration for React frontend
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.HEAD,
                    ],
                    allowedOrigins: ['*'], // Will be restricted to specific domain in production
                    allowedHeaders: ['*'],
                    maxAge: 3000,
                },
            ],
        });
        cdk.Tags.of(this.staticAssetsBucket).add('Name', `codeflow-static-assets-${environmentName}`);
        cdk.Tags.of(this.staticAssetsBucket).add('Environment', environmentName);
        // Knowledge Base Documents Bucket (Algorithm explanations, patterns, debugging guides)
        this.kbDocumentsBucket = new s3.Bucket(this, 'KBDocumentsBucket', {
            bucketName: `codeflow-kb-documents-${environmentName}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true, // Enable versioning for knowledge base documents
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            // Lifecycle policies: Transition to IA after 90 days
            lifecycleRules: [
                {
                    id: 'TransitionToIA',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(90),
                        },
                    ],
                },
                {
                    id: 'CleanupOldVersions',
                    enabled: true,
                    noncurrentVersionTransitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                    ],
                    noncurrentVersionExpiration: cdk.Duration.days(90),
                },
            ],
            // CORS configuration for Bedrock Knowledge Base access
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.POST,
                    ],
                    allowedOrigins: ['*'], // Bedrock service will access this
                    allowedHeaders: ['*'],
                    maxAge: 3000,
                },
            ],
        });
        cdk.Tags.of(this.kbDocumentsBucket).add('Name', `codeflow-kb-documents-${environmentName}`);
        cdk.Tags.of(this.kbDocumentsBucket).add('Environment', environmentName);
        // Datasets Bucket (LeetCode problem archives, user submission exports, analytics snapshots)
        this.datasetsBucket = new s3.Bucket(this, 'DatasetsBucket', {
            bucketName: `codeflow-datasets-${environmentName}-${this.account}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: false,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            autoDeleteObjects: false,
            // Lifecycle policies: IA after 90 days, Glacier after 180 days
            lifecycleRules: [
                {
                    id: 'TransitionToIA',
                    enabled: true,
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(90),
                        },
                        {
                            storageClass: s3.StorageClass.GLACIER,
                            transitionAfter: cdk.Duration.days(180),
                        },
                    ],
                },
            ],
        });
        cdk.Tags.of(this.datasetsBucket).add('Name', `codeflow-datasets-${environmentName}`);
        cdk.Tags.of(this.datasetsBucket).add('Environment', environmentName);
        // ========================================
        // Amazon OpenSearch Domain (Vector Search)
        // ========================================
        // Create IAM role for OpenSearch domain
        const openSearchRole = new iam.Role(this, 'OpenSearchRole', {
            roleName: `codeflow-opensearch-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('opensearchservice.amazonaws.com'),
            description: 'IAM role for OpenSearch domain',
        });
        // OpenSearch Domain for vector search with k-NN
        this.openSearchDomain = new opensearch.Domain(this, 'OpenSearchDomain', {
            domainName: `codeflow-opensearch-${environmentName}`,
            version: opensearch.EngineVersion.OPENSEARCH_2_11,
            // Capacity configuration: r6g.large.search, 2 nodes
            capacity: {
                dataNodeInstanceType: 'r6g.large.search',
                dataNodes: 2,
                multiAzWithStandbyEnabled: false, // Cost optimization for dev/staging
            },
            // EBS storage: 100GB per node
            ebs: {
                enabled: true,
                volumeSize: 100,
                volumeType: ec2.EbsDeviceVolumeType.GP3,
                iops: 3000,
                throughput: 125,
            },
            // VPC configuration for secure access
            vpc: this.vpc,
            vpcSubnets: [
                {
                    subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
                    availabilityZones: this.vpc.availabilityZones.slice(0, 2),
                },
            ],
            securityGroups: [this.openSearchSecurityGroup],
            // Encryption configuration
            encryptionAtRest: {
                enabled: true,
            },
            nodeToNodeEncryption: true,
            enforceHttps: true,
            // Fine-grained access control
            fineGrainedAccessControl: {
                masterUserArn: openSearchRole.roleArn,
            },
            // Logging configuration
            logging: {
                slowSearchLogEnabled: true,
                appLogEnabled: true,
                slowIndexLogEnabled: true,
                slowSearchLogGroup: new logs.LogGroup(this, 'OpenSearchSlowSearchLogs', {
                    logGroupName: `/aws/opensearch/codeflow-${environmentName}/slow-search`,
                    retention: logs.RetentionDays.ONE_WEEK,
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                }),
                appLogGroup: new logs.LogGroup(this, 'OpenSearchAppLogs', {
                    logGroupName: `/aws/opensearch/codeflow-${environmentName}/app`,
                    retention: logs.RetentionDays.ONE_WEEK,
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                }),
                slowIndexLogGroup: new logs.LogGroup(this, 'OpenSearchSlowIndexLogs', {
                    logGroupName: `/aws/opensearch/codeflow-${environmentName}/slow-index`,
                    retention: logs.RetentionDays.ONE_WEEK,
                    removalPolicy: cdk.RemovalPolicy.DESTROY,
                }),
            },
            // Advanced options for k-NN plugin
            advancedOptions: {
                'rest.action.multi.allow_explicit_index': 'true',
                'indices.query.bool.max_clause_count': '1024',
            },
            // Automated snapshots
            automatedSnapshotStartHour: 2, // 2 AM UTC
            // Removal policy
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            // Enable custom endpoint (optional)
            customEndpoint: undefined,
            // Zone awareness for high availability
            zoneAwareness: {
                enabled: true,
                availabilityZoneCount: 2,
            },
        });
        // Grant Lambda access to OpenSearch
        this.openSearchDomain.grantReadWrite(openSearchRole);
        // Note: Access control for VPC-based OpenSearch is managed through security groups
        // IP-based access policies are not compatible with VPC endpoints
        cdk.Tags.of(this.openSearchDomain).add('Name', `codeflow-opensearch-${environmentName}`);
        cdk.Tags.of(this.openSearchDomain).add('Environment', environmentName);
        // ========================================
        // Amazon Bedrock Knowledge Base Configuration
        // ========================================
        // Create IAM role for Bedrock Knowledge Base
        this.bedrockKnowledgeBaseRole = new iam.Role(this, 'BedrockKnowledgeBaseRole', {
            roleName: `codeflow-bedrock-kb-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
            description: 'IAM role for Bedrock Knowledge Base to access S3 and OpenSearch',
        });
        // Grant S3 read permissions to Bedrock Knowledge Base
        this.kbDocumentsBucket.grantRead(this.bedrockKnowledgeBaseRole);
        // Grant OpenSearch permissions to Bedrock Knowledge Base
        this.bedrockKnowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'aoss:APIAccessAll', // OpenSearch Serverless (if using serverless)
                'es:ESHttpGet',
                'es:ESHttpPost',
                'es:ESHttpPut',
                'es:ESHttpDelete',
                'es:ESHttpHead',
            ],
            resources: [
                this.openSearchDomain.domainArn,
                `${this.openSearchDomain.domainArn}/*`,
            ],
        }));
        // Grant Bedrock model invocation permissions
        this.bedrockKnowledgeBaseRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
            ],
            resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
            ],
        }));
        cdk.Tags.of(this.bedrockKnowledgeBaseRole).add('Name', `codeflow-bedrock-kb-role-${environmentName}`);
        cdk.Tags.of(this.bedrockKnowledgeBaseRole).add('Environment', environmentName);
        // Note: Bedrock Knowledge Base creation is not directly supported by CDK L2 constructs yet.
        // We need to use L1 (CloudFormation) constructs or create it manually/via AWS CLI.
        // The following is a CloudFormation-based approach using L1 constructs.
        // Create Bedrock Knowledge Base using L1 construct
        // TODO: Temporarily disabled - requires OpenSearch Serverless collection setup
        // Will be added in a follow-up deployment
        /*
        this.bedrockKnowledgeBase = new cdk.aws_bedrock.CfnKnowledgeBase(this, 'BedrockKnowledgeBase', {
          name: `kb-codeflow-algorithms-${environmentName}`,
          description: 'Knowledge Base for CodeFlow AI Platform containing algorithm explanations, patterns, and debugging guides',
          roleArn: this.bedrockKnowledgeBaseRole.roleArn,
          knowledgeBaseConfiguration: {
            type: 'VECTOR',
            vectorKnowledgeBaseConfiguration: {
              embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v1`,
            },
          },
          storageConfiguration: {
            type: 'OPENSEARCH_SERVERLESS',
            opensearchServerlessConfiguration: {
              collectionArn: `arn:aws:aoss:${this.region}:${this.account}:collection/codeflow-kb-${environmentName}`,
              vectorIndexName: 'codeflow-kb-index',
              fieldMapping: {
                vectorField: 'embedding',
                textField: 'text',
                metadataField: 'metadata',
              },
            },
          },
        });
    
        // Add dependency to ensure role is created before Knowledge Base
        // this.bedrockKnowledgeBase.node.addDependency(this.bedrockKnowledgeBaseRole);
        // this.bedrockKnowledgeBase.node.addDependency(this.openSearchDomain);
        // this.bedrockKnowledgeBase.node.addDependency(this.kbDocumentsBucket);
    
        // cdk.Tags.of(this.bedrockKnowledgeBase).add('Name', `kb-codeflow-algorithms-${environmentName}`);
        // cdk.Tags.of(this.bedrockKnowledgeBase).add('Environment', environmentName);
    
        // Create Bedrock Knowledge Base Data Source (S3)
        // TODO: Temporarily disabled - depends on Knowledge Base
        /*
        this.bedrockDataSource = new cdk.aws_bedrock.CfnDataSource(this, 'BedrockDataSource', {
          name: `codeflow-kb-s3-datasource-${environmentName}`,
          description: 'S3 data source for CodeFlow Knowledge Base',
          knowledgeBaseId: this.bedrockKnowledgeBase.attrKnowledgeBaseId,
          dataSourceConfiguration: {
            type: 'S3',
            s3Configuration: {
              bucketArn: this.kbDocumentsBucket.bucketArn,
            },
          },
          vectorIngestionConfiguration: {
            chunkingConfiguration: {
              chunkingStrategy: 'FIXED_SIZE',
              fixedSizeChunkingConfiguration: {
                maxTokens: 500,
                overlapPercentage: 10,
              },
            },
          },
        });
    
        // Add dependency to ensure Knowledge Base is created before Data Source
        this.bedrockDataSource.node.addDependency(this.bedrockKnowledgeBase);
    
        // cdk.Tags.of(this.bedrockDataSource).add('Name', `codeflow-kb-s3-datasource-${environmentName}`);
        // cdk.Tags.of(this.bedrockDataSource).add('Environment', environmentName);
    
        // Create EventBridge rule for daily Knowledge Base sync (2 AM UTC)
        // TODO: Temporarily disabled - depends on Knowledge Base
        /*
        const kbSyncRule = new events.Rule(this, 'KnowledgeBaseSyncRule', {
          ruleName: `codeflow-kb-sync-${environmentName}`,
          description: 'Daily sync of Bedrock Knowledge Base at 2 AM UTC',
          schedule: events.Schedule.cron({
            minute: '0',
            hour: '2',
            day: '*',
            month: '*',
            year: '*',
          }),
          enabled: true,
        });
        */
        // TODO: Temporarily disabled - depends on Knowledge Base
        /*
        // Create Lambda function to trigger Knowledge Base sync
        const kbSyncFunction = new lambda.Function(this, 'KBSyncFunction', {
          functionName: `codeflow-kb-sync-${environmentName}`,
          runtime: lambda.Runtime.PYTHON_3_11,
          handler: 'index.handler',
          code: lambda.Code.fromInline(`
    import json
    import boto3
    import os
    
    bedrock_agent = boto3.client('bedrock-agent')
    
    def handler(event, context):
        """
        Trigger Bedrock Knowledge Base data source sync.
        This function is invoked daily at 2 AM UTC by EventBridge.
        """
        knowledge_base_id = os.environ['KNOWLEDGE_BASE_ID']
        data_source_id = os.environ['DATA_SOURCE_ID']
        
        try:
            # Start ingestion job
            response = bedrock_agent.start_ingestion_job(
                knowledgeBaseId=knowledge_base_id,
                dataSourceId=data_source_id,
                description=f'Daily sync triggered at {event["time"]}'
            )
            
            print(f"Started ingestion job: {response['ingestionJob']['ingestionJobId']}")
            
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'Knowledge Base sync started successfully',
                    'ingestionJobId': response['ingestionJob']['ingestionJobId'],
                    'status': response['ingestionJob']['status']
                })
            }
        except Exception as e:
            print(f"Error starting ingestion job: {str(e)}")
            return {
                'statusCode': 500,
                'body': json.dumps({
                    'message': 'Failed to start Knowledge Base sync',
                    'error': str(e)
                })
            }
    `),
          timeout: cdk.Duration.seconds(30),
          memorySize: 256,
          environment: {
            KNOWLEDGE_BASE_ID: this.bedrockKnowledgeBase.attrKnowledgeBaseId,
            DATA_SOURCE_ID: this.bedrockDataSource.attrDataSourceId,
            ENVIRONMENT: environmentName,
          },
          description: 'Trigger daily sync of Bedrock Knowledge Base',
        });
    
        // Grant permissions to start ingestion job
        kbSyncFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:StartIngestionJob',
            'bedrock:GetIngestionJob',
            'bedrock:ListIngestionJobs',
          ],
          resources: [
            `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${this.bedrockKnowledgeBase.attrKnowledgeBaseId}`,
            `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/${this.bedrockKnowledgeBase.attrKnowledgeBaseId}/data-source/${this.bedrockDataSource.attrDataSourceId}`,
          ],
        }));
    
        // Add Lambda function as target for EventBridge rule
        kbSyncRule.addTarget(new targets.LambdaFunction(kbSyncFunction, {
          retryAttempts: 2,
          maxEventAge: cdk.Duration.hours(2),
        }));
    
        cdk.Tags.of(kbSyncFunction).add('Name', `codeflow-kb-sync-${environmentName}`);
        cdk.Tags.of(kbSyncFunction).add('Environment', environmentName);
        cdk.Tags.of(kbSyncRule).add('Name', `codeflow-kb-sync-${environmentName}`);
        cdk.Tags.of(kbSyncRule).add('Environment', environmentName);
        */
        // ========================================
        // Lambda Authorizer for JWT Validation
        // ========================================
        // Create Lambda function for JWT validation
        const jwtAuthorizerFunction = new lambda.Function(this, 'JWTAuthorizerFunction', {
            functionName: `codeflow-jwt-authorizer-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/jwt-authorizer'),
            timeout: cdk.Duration.seconds(10),
            memorySize: 256,
            environment: {
                ENVIRONMENT: environmentName,
                JWT_SECRET: 'PLACEHOLDER_JWT_SECRET', // Same as auth Lambda
            },
            description: 'JWT token validation for API Gateway',
        });
        cdk.Tags.of(jwtAuthorizerFunction).add('Name', `codeflow-jwt-authorizer-${environmentName}`);
        cdk.Tags.of(jwtAuthorizerFunction).add('Environment', environmentName);
        // ========================================
        // API Gateway REST API
        // ========================================
        // Create CloudWatch log group for API Gateway access logs
        const apiLogGroup = new logs.LogGroup(this, 'APIGatewayAccessLogs', {
            logGroupName: `/aws/apigateway/codeflow-${environmentName}`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // Create REST API Gateway
        this.restApi = new apigateway.RestApi(this, 'CodeFlowRestAPI', {
            restApiName: `codeflow-api-${environmentName}`,
            description: 'CodeFlow AI Platform REST API',
            // Deploy options
            deployOptions: {
                stageName: environmentName,
                // Enable access logging
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
                    caller: true,
                    httpMethod: true,
                    ip: true,
                    protocol: true,
                    requestTime: true,
                    resourcePath: true,
                    responseLength: true,
                    status: true,
                    user: true,
                }),
                // Enable CloudWatch metrics
                metricsEnabled: true,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
                // Throttling settings (global defaults)
                throttlingRateLimit: 1000, // requests per second
                throttlingBurstLimit: 2000, // burst capacity
                // Enable X-Ray tracing
                tracingEnabled: true,
            },
            // CORS configuration for React frontend
            defaultCorsPreflightOptions: {
                allowOrigins: [
                    'http://localhost:5173', // Vite dev server
                    'http://localhost:3000', // Alternative dev port
                    'https://codeflow.ai', // Production domain (placeholder)
                ],
                allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowHeaders: [
                    'Content-Type',
                    'Authorization',
                    'X-Request-ID',
                    'X-Amz-Date',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                ],
                allowCredentials: true,
                maxAge: cdk.Duration.hours(1),
            },
            // Enable API key requirement for admin endpoints
            apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
            // Cloud formation removal policy
            cloudWatchRole: true,
            // Endpoint configuration
            endpointConfiguration: {
                types: [apigateway.EndpointType.REGIONAL],
            },
        });
        cdk.Tags.of(this.restApi).add('Name', `codeflow-api-${environmentName}`);
        cdk.Tags.of(this.restApi).add('Environment', environmentName);
        // Add Gateway Responses for CORS on error responses
        this.restApi.addGatewayResponse('Unauthorized403', {
            type: apigateway.ResponseType.UNAUTHORIZED,
            statusCode: '403',
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Request-ID'",
                'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
            },
        });
        this.restApi.addGatewayResponse('AccessDenied', {
            type: apigateway.ResponseType.ACCESS_DENIED,
            statusCode: '403',
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Request-ID'",
                'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
            },
        });
        this.restApi.addGatewayResponse('Default4XX', {
            type: apigateway.ResponseType.DEFAULT_4XX,
            responseHeaders: {
                'Access-Control-Allow-Origin': "'*'",
                'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Request-ID'",
                'Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
            },
        });
        // ========================================
        // Request Validators
        // ========================================
        // Create request validator for body and parameters
        const requestValidator = new apigateway.RequestValidator(this, 'RequestValidator', {
            restApi: this.restApi,
            requestValidatorName: 'request-body-validator',
            validateRequestBody: true,
            validateRequestParameters: true,
        });
        // ========================================
        // Lambda Authorizer
        // ========================================
        // Create Lambda authorizer for JWT validation
        // Note: The authorizer will be automatically attached to the REST API when used in method configurations
        this.jwtAuthorizer = new apigateway.RequestAuthorizer(this, 'JWTAuthorizer', {
            handler: jwtAuthorizerFunction,
            identitySources: [apigateway.IdentitySource.header('Authorization')],
            authorizerName: 'jwt-authorizer',
            resultsCacheTtl: cdk.Duration.minutes(5), // Cache authorization results for 5 minutes
        });
        // Bind the authorizer to the REST API
        this.jwtAuthorizer._attachToApi(this.restApi);
        // ========================================
        // JSON Schema Models for Request Validation
        // ========================================
        // User registration request model
        const registerRequestModel = this.restApi.addModel('RegisterRequestModel', {
            contentType: 'application/json',
            modelName: 'RegisterRequest',
            schema: {
                type: apigateway.JsonSchemaType.OBJECT,
                required: ['username', 'password', 'leetcode_username'],
                properties: {
                    username: {
                        type: apigateway.JsonSchemaType.STRING,
                        minLength: 3,
                        maxLength: 50,
                        pattern: '^[a-zA-Z0-9_-]+$',
                    },
                    password: {
                        type: apigateway.JsonSchemaType.STRING,
                        minLength: 8,
                        maxLength: 128,
                    },
                    leetcode_username: {
                        type: apigateway.JsonSchemaType.STRING,
                        minLength: 1,
                        maxLength: 50,
                    },
                },
            },
        });
        // User login request model
        const loginRequestModel = this.restApi.addModel('LoginRequestModel', {
            contentType: 'application/json',
            modelName: 'LoginRequest',
            schema: {
                type: apigateway.JsonSchemaType.OBJECT,
                required: ['username', 'password'],
                properties: {
                    username: {
                        type: apigateway.JsonSchemaType.STRING,
                        minLength: 3,
                        maxLength: 50,
                    },
                    password: {
                        type: apigateway.JsonSchemaType.STRING,
                        minLength: 8,
                        maxLength: 128,
                    },
                },
            },
        });
        // Chat message request model
        const chatMessageRequestModel = this.restApi.addModel('ChatMessageRequestModel', {
            contentType: 'application/json',
            modelName: 'ChatMessageRequest',
            schema: {
                type: apigateway.JsonSchemaType.OBJECT,
                required: ['message'],
                properties: {
                    message: {
                        type: apigateway.JsonSchemaType.STRING,
                        minLength: 1,
                        maxLength: 5000,
                    },
                    code: {
                        type: apigateway.JsonSchemaType.STRING,
                        maxLength: 10000,
                    },
                    problem_id: {
                        type: apigateway.JsonSchemaType.STRING,
                        maxLength: 100,
                    },
                },
            },
        });
        // ========================================
        // Usage Plans and API Keys
        // ========================================
        // Create usage plan for authenticated users (100 req/min per user)
        const userUsagePlan = this.restApi.addUsagePlan('UserUsagePlan', {
            name: `codeflow-user-plan-${environmentName}`,
            description: 'Usage plan for authenticated users',
            throttle: {
                rateLimit: 100, // 100 requests per minute per user
                burstLimit: 200, // Allow burst of 200 requests
            },
            quota: {
                limit: 10000, // 10,000 requests per month per user
                period: apigateway.Period.MONTH,
            },
        });
        // Associate usage plan with API stage
        userUsagePlan.addApiStage({
            stage: this.restApi.deploymentStage,
        });
        // Create usage plan for anonymous/IP-based rate limiting (10 req/min per IP)
        const anonymousUsagePlan = this.restApi.addUsagePlan('AnonymousUsagePlan', {
            name: `codeflow-anonymous-plan-${environmentName}`,
            description: 'Usage plan for anonymous users (IP-based rate limiting)',
            throttle: {
                rateLimit: 10, // 10 requests per minute per IP
                burstLimit: 20, // Allow burst of 20 requests
            },
            quota: {
                limit: 1000, // 1,000 requests per month per IP
                period: apigateway.Period.MONTH,
            },
        });
        // Associate anonymous usage plan with API stage
        anonymousUsagePlan.addApiStage({
            stage: this.restApi.deploymentStage,
        });
        // Create API key for admin endpoints
        const adminApiKey = this.restApi.addApiKey('AdminApiKey', {
            apiKeyName: `codeflow-admin-key-${environmentName}`,
            description: 'API key for admin endpoints',
        });
        // Create usage plan for admin (higher limits)
        const adminUsagePlan = this.restApi.addUsagePlan('AdminUsagePlan', {
            name: `codeflow-admin-plan-${environmentName}`,
            description: 'Usage plan for admin endpoints',
            throttle: {
                rateLimit: 500, // 500 requests per minute
                burstLimit: 1000, // Allow burst of 1000 requests
            },
            quota: {
                limit: 100000, // 100,000 requests per month
                period: apigateway.Period.MONTH,
            },
        });
        // Associate admin API key with usage plan
        adminUsagePlan.addApiKey(adminApiKey);
        // Associate admin usage plan with API stage
        adminUsagePlan.addApiStage({
            stage: this.restApi.deploymentStage,
        });
        // ========================================
        // API Gateway Resource Structure (Placeholder)
        // ========================================
        // Create /auth resource
        const authResource = this.restApi.root.addResource('auth');
        // Create /analyze resource
        const analyzeResource = this.restApi.root.addResource('analyze');
        // Create /chat resource
        const chatResource = this.restApi.root.addResource('chat');
        // Create /recommendations resource
        const recommendationsResource = this.restApi.root.addResource('recommendations');
        // Create /progress resource
        const progressResource = this.restApi.root.addResource('progress');
        // Create /admin resource
        const adminResource = this.restApi.root.addResource('admin');
        // Create /interview resource
        const interviewResource = this.restApi.root.addResource('interview');
        // Note: Actual Lambda integrations will be added in task 1.6 when Lambda functions are created
        // ========================================
        // Lambda Layer for Shared Dependencies
        // ========================================
        // Create Lambda layer for shared dependencies (boto3, pydantic, httpx)
        this.sharedDependenciesLayer = new lambda.LayerVersion(this, 'SharedDependenciesLayer', {
            layerVersionName: `codeflow-shared-dependencies-${environmentName}`,
            code: lambda.Code.fromAsset('../lambda-layers/shared-dependencies'),
            compatibleRuntimes: [lambda.Runtime.PYTHON_3_11],
            description: 'Shared dependencies: boto3, pydantic, httpx, and common utilities',
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        cdk.Tags.of(this.sharedDependenciesLayer).add('Name', `codeflow-shared-dependencies-${environmentName}`);
        cdk.Tags.of(this.sharedDependenciesLayer).add('Environment', environmentName);
        // ========================================
        // SQS Queues for Background Jobs
        // ========================================
        // Dead Letter Queue for failed events
        this.deadLetterQueue = new sqs.Queue(this, 'DeadLetterQueue', {
            queueName: `codeflow-dlq-${environmentName}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            retentionPeriod: cdk.Duration.days(14), // Keep failed messages for 14 days
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        cdk.Tags.of(this.deadLetterQueue).add('Name', `codeflow-dlq-${environmentName}`);
        cdk.Tags.of(this.deadLetterQueue).add('Environment', environmentName);
        // Background Jobs Queue (Standard Queue)
        this.backgroundJobsQueue = new sqs.Queue(this, 'BackgroundJobsQueue', {
            queueName: `codeflow-background-jobs-${environmentName}`,
            encryption: sqs.QueueEncryption.SQS_MANAGED,
            visibilityTimeout: cdk.Duration.minutes(15), // 15 minutes for heavy processing
            receiveMessageWaitTime: cdk.Duration.seconds(20), // Long polling
            retentionPeriod: cdk.Duration.days(4), // Keep messages for 4 days
            deadLetterQueue: {
                queue: this.deadLetterQueue,
                maxReceiveCount: 3, // Move to DLQ after 3 failed attempts
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        cdk.Tags.of(this.backgroundJobsQueue).add('Name', `codeflow-background-jobs-${environmentName}`);
        cdk.Tags.of(this.backgroundJobsQueue).add('Environment', environmentName);
        // ========================================
        // EventBridge Event Bus
        // ========================================
        // Create custom event bus for CodeFlow events
        this.eventBus = new events.EventBus(this, 'CodeFlowEventBus', {
            eventBusName: `codeflow-events-${environmentName}`,
        });
        cdk.Tags.of(this.eventBus).add('Name', `codeflow-events-${environmentName}`);
        cdk.Tags.of(this.eventBus).add('Environment', environmentName);
        // ========================================
        // Lambda Functions
        // ========================================
        // Common environment variables for all Lambda functions
        const commonEnvironment = {
            ENVIRONMENT: environmentName,
            USERS_TABLE: this.usersTable.tableName,
            LEARNING_PATHS_TABLE: this.learningPathsTable.tableName,
            PROGRESS_TABLE: this.progressTable.tableName,
            LLM_CACHE_TABLE: this.llmCacheTable.tableName,
            CONVERSATION_HISTORY_TABLE: this.conversationHistoryTable.tableName,
            KNOWLEDGE_BASE_TABLE: this.knowledgeBaseTable.tableName,
            ANALYTICS_TABLE: this.analyticsTable.tableName,
            OPENSEARCH_ENDPOINT: this.openSearchDomain.domainEndpoint,
            KB_DOCUMENTS_BUCKET: this.kbDocumentsBucket.bucketName,
            DATASETS_BUCKET: this.datasetsBucket.bucketName,
            REGION: this.region, // Changed from AWS_REGION to REGION (AWS_REGION is reserved)
            EVENT_BUS_NAME: this.eventBus.eventBusName,
            BACKGROUND_JOBS_QUEUE_URL: this.backgroundJobsQueue.queueUrl,
        };
        // ========================================
        // 1. Auth Lambda Function
        // ========================================
        // Create IAM role for Auth Lambda
        const authLambdaRole = new iam.Role(this, 'AuthLambdaRole', {
            roleName: `codeflow-auth-lambda-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'IAM role for Auth Lambda function',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Grant DynamoDB permissions (Users table only)
        this.usersTable.grantReadWriteData(authLambdaRole);
        // Grant X-Ray permissions
        authLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        // Create Auth Lambda function
        this.authFunction = new lambda.Function(this, 'AuthFunction', {
            functionName: `codeflow-auth-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/auth'),
            role: authLambdaRole,
            layers: [this.sharedDependenciesLayer],
            timeout: cdk.Duration.seconds(10),
            memorySize: 512,
            environment: {
                ...commonEnvironment,
                JWT_SECRET: 'PLACEHOLDER_JWT_SECRET', // TODO: Use Secrets Manager in production
            },
            description: 'Authentication service: user registration, login, JWT token generation',
            tracing: lambda.Tracing.ACTIVE, // Enable X-Ray tracing
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.lambdaSecurityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        cdk.Tags.of(this.authFunction).add('Name', `codeflow-auth-${environmentName}`);
        cdk.Tags.of(this.authFunction).add('Environment', environmentName);
        // ========================================
        // 2. Analysis Lambda Function
        // ========================================
        // Create IAM role for Analysis Lambda
        const analysisLambdaRole = new iam.Role(this, 'AnalysisLambdaRole', {
            roleName: `codeflow-analysis-lambda-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'IAM role for Analysis Lambda function',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Grant DynamoDB permissions
        this.usersTable.grantReadWriteData(analysisLambdaRole);
        this.progressTable.grantReadWriteData(analysisLambdaRole);
        this.analyticsTable.grantReadWriteData(analysisLambdaRole);
        // Grant EventBridge permissions
        analysisLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'events:PutEvents',
            ],
            resources: [`arn:aws:events:${this.region}:${this.account}:event-bus/codeflow-events-${environmentName}`],
        }));
        // Grant X-Ray permissions
        analysisLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        // Create Analysis Lambda function
        this.analysisFunction = new lambda.Function(this, 'AnalysisFunction', {
            functionName: `codeflow-analysis-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/analysis'),
            role: analysisLambdaRole,
            layers: [this.sharedDependenciesLayer],
            timeout: cdk.Duration.seconds(30),
            memorySize: 1024,
            environment: commonEnvironment,
            description: 'Profile analysis service: parse submissions, classify topics, calculate proficiency',
            tracing: lambda.Tracing.ACTIVE,
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.lambdaSecurityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        cdk.Tags.of(this.analysisFunction).add('Name', `codeflow-analysis-${environmentName}`);
        cdk.Tags.of(this.analysisFunction).add('Environment', environmentName);
        // ========================================
        // 3. Recommendations Lambda Function
        // ========================================
        // Create IAM role for Recommendations Lambda
        const recommendationsLambdaRole = new iam.Role(this, 'RecommendationsLambdaRole', {
            roleName: `codeflow-recommendations-lambda-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'IAM role for Recommendations Lambda function',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Grant DynamoDB permissions
        this.usersTable.grantReadData(recommendationsLambdaRole);
        this.learningPathsTable.grantReadWriteData(recommendationsLambdaRole);
        this.progressTable.grantReadData(recommendationsLambdaRole);
        this.llmCacheTable.grantReadWriteData(recommendationsLambdaRole);
        // Grant Bedrock permissions (including Nova inference profiles)
        recommendationsLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
            ],
            resources: [
                `arn:aws:bedrock:*::foundation-model/*`,
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
            ],
        }));
        // Grant AWS Marketplace permissions for Bedrock model access
        recommendationsLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'aws-marketplace:ViewSubscriptions',
                'aws-marketplace:Subscribe',
            ],
            resources: ['*'],
        }));
        // Grant X-Ray permissions
        recommendationsLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        // Create Recommendations Lambda function
        this.recommendationsFunction = new lambda.Function(this, 'RecommendationsFunction', {
            functionName: `codeflow-recommendations-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/recommendations'),
            role: recommendationsLambdaRole,
            layers: [this.sharedDependenciesLayer],
            timeout: cdk.Duration.seconds(30),
            memorySize: 1024,
            environment: commonEnvironment,
            description: 'Recommendation engine: Goldilocks algorithm, learning path generation, adaptive difficulty',
            tracing: lambda.Tracing.ACTIVE,
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.lambdaSecurityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        cdk.Tags.of(this.recommendationsFunction).add('Name', `codeflow-recommendations-${environmentName}`);
        cdk.Tags.of(this.recommendationsFunction).add('Environment', environmentName);
        // ========================================
        // 4. Chat Mentor Lambda Function
        // ========================================
        // Create IAM role for Chat Mentor Lambda
        const chatMentorLambdaRole = new iam.Role(this, 'ChatMentorLambdaRole', {
            roleName: `codeflow-chat-mentor-lambda-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'IAM role for Chat Mentor Lambda function',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Grant DynamoDB permissions
        this.usersTable.grantReadData(chatMentorLambdaRole);
        this.conversationHistoryTable.grantReadWriteData(chatMentorLambdaRole);
        this.llmCacheTable.grantReadWriteData(chatMentorLambdaRole);
        // Grant Bedrock permissions (including Knowledge Base and Nova inference profiles)
        chatMentorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate',
            ],
            resources: [
                `arn:aws:bedrock:*::foundation-model/*`,
                `arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`,
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
            ],
        }));
        // Grant AWS Marketplace permissions for Bedrock model access
        chatMentorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'aws-marketplace:ViewSubscriptions',
                'aws-marketplace:Subscribe',
            ],
            resources: ['*'],
        }));
        // Grant OpenSearch permissions
        chatMentorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'es:ESHttpGet',
                'es:ESHttpPost',
                'es:ESHttpPut',
            ],
            resources: [
                `${this.openSearchDomain.domainArn}/*`,
            ],
        }));
        // Grant X-Ray permissions
        chatMentorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        // Create Chat Mentor Lambda function
        this.chatMentorFunction = new lambda.Function(this, 'ChatMentorFunction', {
            functionName: `codeflow-chat-mentor-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/chat-mentor'),
            role: chatMentorLambdaRole,
            layers: [this.sharedDependenciesLayer],
            timeout: cdk.Duration.seconds(60),
            memorySize: 2048,
            environment: commonEnvironment,
            description: 'Conversational AI mentor: multi-step reasoning, RAG, code analysis, Bedrock integration',
            tracing: lambda.Tracing.ACTIVE,
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.lambdaSecurityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        cdk.Tags.of(this.chatMentorFunction).add('Name', `codeflow-chat-mentor-${environmentName}`);
        cdk.Tags.of(this.chatMentorFunction).add('Environment', environmentName);
        // ========================================
        // 5. Scraping Lambda Function
        // ========================================
        // Create IAM role for Scraping Lambda
        const scrapingLambdaRole = new iam.Role(this, 'ScrapingLambdaRole', {
            roleName: `codeflow-scraping-lambda-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'IAM role for Scraping Lambda function',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Grant DynamoDB permissions
        this.usersTable.grantReadWriteData(scrapingLambdaRole);
        // Grant S3 permissions for caching scraped data
        this.datasetsBucket.grantReadWrite(scrapingLambdaRole);
        // Grant X-Ray permissions
        scrapingLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        // Create Scraping Lambda function
        this.scrapingFunction = new lambda.Function(this, 'ScrapingFunction', {
            functionName: `codeflow-scraping-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/scraping'),
            role: scrapingLambdaRole,
            layers: [this.sharedDependenciesLayer],
            timeout: cdk.Duration.seconds(30),
            memorySize: 1024,
            environment: commonEnvironment,
            description: 'LeetCode scraping service: fetch user profiles, submissions, with retry logic and rate limiting',
            tracing: lambda.Tracing.ACTIVE,
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.lambdaSecurityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        cdk.Tags.of(this.scrapingFunction).add('Name', `codeflow-scraping-${environmentName}`);
        cdk.Tags.of(this.scrapingFunction).add('Environment', environmentName);
        // Create Interview Simulator Lambda function
        const interviewSimulatorLambdaRole = new iam.Role(this, 'InterviewSimulatorLambdaRole', {
            roleName: `codeflow-interview-simulator-lambda-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            description: 'IAM role for Interview Simulator Lambda function',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
            ],
        });
        // Grant DynamoDB permissions
        this.interviewSessionsTable.grantReadWriteData(interviewSimulatorLambdaRole);
        this.usersTable.grantReadWriteData(interviewSimulatorLambdaRole);
        this.llmCacheTable.grantReadWriteData(interviewSimulatorLambdaRole);
        // Grant S3 permissions for overflow storage
        this.datasetsBucket.grantReadWrite(interviewSimulatorLambdaRole);
        // Grant Bedrock permissions (including Nova inference profiles)
        interviewSimulatorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
            ],
            resources: [
                `arn:aws:bedrock:*::foundation-model/*`,
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
            ],
        }));
        // Grant AWS Marketplace permissions for Bedrock model access
        interviewSimulatorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'aws-marketplace:ViewSubscriptions',
                'aws-marketplace:Subscribe',
            ],
            resources: ['*'],
        }));
        // Grant CloudWatch permissions
        interviewSimulatorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents',
                'cloudwatch:PutMetricData',
            ],
            resources: ['*'],
        }));
        // Grant X-Ray permissions
        interviewSimulatorLambdaRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        this.interviewSimulatorFunction = new lambda.Function(this, 'InterviewSimulatorFunction', {
            functionName: `codeflow-interview-simulator-${environmentName}`,
            runtime: lambda.Runtime.PYTHON_3_11,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('../lambda-functions/interview-simulator'),
            role: interviewSimulatorLambdaRole,
            layers: [this.sharedDependenciesLayer],
            timeout: cdk.Duration.seconds(60),
            memorySize: 512,
            environment: {
                ...commonEnvironment,
                INTERVIEW_SESSIONS_TABLE: this.interviewSessionsTable.tableName,
                BEDROCK_MODEL_ID: 'anthropic.claude-3-sonnet-20240229-v1:0',
                S3_BUCKET: this.datasetsBucket.bucketName,
            },
            description: 'AI Interview Simulator: mock technical interviews with Bedrock Claude 3 Sonnet',
            tracing: lambda.Tracing.ACTIVE,
            vpc: this.vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.lambdaSecurityGroup],
            logRetention: logs.RetentionDays.ONE_WEEK,
        });
        cdk.Tags.of(this.interviewSimulatorFunction).add('Name', `codeflow-interview-simulator-${environmentName}`);
        cdk.Tags.of(this.interviewSimulatorFunction).add('Environment', environmentName);
        // ========================================
        // EventBridge Rules and Targets
        // ========================================
        // Rule 1: Profile Analysis Complete → ECS Task (Weakness Analysis)
        const profileAnalysisCompleteRule = new events.Rule(this, 'ProfileAnalysisCompleteRule', {
            ruleName: `codeflow-profile-analysis-complete-${environmentName}`,
            description: 'Trigger ECS task for weakness analysis when profile analysis completes',
            eventBus: this.eventBus,
            eventPattern: {
                source: ['codeflow.analysis'],
                detailType: ['ProfileAnalysisComplete'],
            },
            enabled: true,
        });
        // Add SQS queue as target for Profile Analysis Complete
        // Note: ECS task target will be added in task 1.8 when ECS cluster is created
        profileAnalysisCompleteRule.addTarget(new targets.SqsQueue(this.backgroundJobsQueue, {
            message: events.RuleTargetInput.fromEventPath('$.detail'),
            deadLetterQueue: this.deadLetterQueue,
        }));
        cdk.Tags.of(profileAnalysisCompleteRule).add('Name', `codeflow-profile-analysis-complete-${environmentName}`);
        cdk.Tags.of(profileAnalysisCompleteRule).add('Environment', environmentName);
        // Rule 2: Learning Path Requested → Lambda (Path Generator)
        const learningPathRequestedRule = new events.Rule(this, 'LearningPathRequestedRule', {
            ruleName: `codeflow-learning-path-requested-${environmentName}`,
            description: 'Trigger Lambda function to generate learning path',
            eventBus: this.eventBus,
            eventPattern: {
                source: ['codeflow.learning'],
                detailType: ['LearningPathRequested'],
            },
            enabled: true,
        });
        // Add Lambda (recommendations) as target for Learning Path Requested
        learningPathRequestedRule.addTarget(new targets.LambdaFunction(this.recommendationsFunction, {
            deadLetterQueue: this.deadLetterQueue,
            maxEventAge: cdk.Duration.hours(2), // Retry for up to 2 hours
            retryAttempts: 2,
        }));
        cdk.Tags.of(learningPathRequestedRule).add('Name', `codeflow-learning-path-requested-${environmentName}`);
        cdk.Tags.of(learningPathRequestedRule).add('Environment', environmentName);
        // Rule 3: Problem Completed → Lambda (Progress Update) + SQS (Analytics)
        const problemCompletedRule = new events.Rule(this, 'ProblemCompletedRule', {
            ruleName: `codeflow-problem-completed-${environmentName}`,
            description: 'Trigger progress update and analytics aggregation when problem is completed',
            eventBus: this.eventBus,
            eventPattern: {
                source: ['codeflow.progress'],
                detailType: ['ProblemCompleted'],
            },
            enabled: true,
        });
        // Add Lambda (analysis) as target for progress update
        problemCompletedRule.addTarget(new targets.LambdaFunction(this.analysisFunction, {
            deadLetterQueue: this.deadLetterQueue,
            maxEventAge: cdk.Duration.hours(1),
            retryAttempts: 2,
        }));
        // Add SQS queue as target for analytics aggregation
        problemCompletedRule.addTarget(new targets.SqsQueue(this.backgroundJobsQueue, {
            message: events.RuleTargetInput.fromEventPath('$.detail'),
            deadLetterQueue: this.deadLetterQueue,
        }));
        cdk.Tags.of(problemCompletedRule).add('Name', `codeflow-problem-completed-${environmentName}`);
        cdk.Tags.of(problemCompletedRule).add('Environment', environmentName);
        // Rule 4: Daily Sync Scheduled → Lambda (LeetCode Sync)
        const dailySyncRule = new events.Rule(this, 'DailySyncRule', {
            ruleName: `codeflow-daily-sync-${environmentName}`,
            description: 'Trigger daily LeetCode data sync at 2 AM UTC',
            schedule: events.Schedule.cron({
                minute: '0',
                hour: '2',
                day: '*',
                month: '*',
                year: '*',
            }), // cron(0 2 * * ? *)
            enabled: true,
        });
        // Add Lambda (scraping) as target for daily sync
        dailySyncRule.addTarget(new targets.LambdaFunction(this.scrapingFunction, {
            deadLetterQueue: this.deadLetterQueue,
            maxEventAge: cdk.Duration.hours(6), // Allow longer retry window for scheduled jobs
            retryAttempts: 3,
        }));
        cdk.Tags.of(dailySyncRule).add('Name', `codeflow-daily-sync-${environmentName}`);
        cdk.Tags.of(dailySyncRule).add('Environment', environmentName);
        // Grant EventBridge permissions to invoke Lambda functions
        this.recommendationsFunction.grantInvoke(new iam.ServicePrincipal('events.amazonaws.com'));
        this.analysisFunction.grantInvoke(new iam.ServicePrincipal('events.amazonaws.com'));
        this.scrapingFunction.grantInvoke(new iam.ServicePrincipal('events.amazonaws.com'));
        // Grant EventBridge permissions to send messages to SQS
        this.backgroundJobsQueue.grantSendMessages(new iam.ServicePrincipal('events.amazonaws.com'));
        this.deadLetterQueue.grantSendMessages(new iam.ServicePrincipal('events.amazonaws.com'));
        // Grant Lambda functions permission to publish events to EventBridge
        this.eventBus.grantPutEventsTo(this.analysisFunction);
        this.eventBus.grantPutEventsTo(this.recommendationsFunction);
        this.eventBus.grantPutEventsTo(this.scrapingFunction);
        // Grant Lambda functions permission to send messages to SQS
        this.backgroundJobsQueue.grantSendMessages(this.analysisFunction);
        this.backgroundJobsQueue.grantSendMessages(this.recommendationsFunction);
        this.backgroundJobsQueue.grantSendMessages(this.scrapingFunction);
        // ========================================
        // ECS Fargate Cluster for Heavy AI Workloads
        // ========================================
        // Create CloudWatch log group for ECS tasks
        const ecsLogGroup = new logs.LogGroup(this, 'ECSLogGroup', {
            logGroupName: `/ecs/codeflow-workers-${environmentName}`,
            retention: logs.RetentionDays.TWO_WEEKS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        cdk.Tags.of(ecsLogGroup).add('Name', `/ecs/codeflow-workers-${environmentName}`);
        cdk.Tags.of(ecsLogGroup).add('Environment', environmentName);
        // Create ECS Cluster
        this.ecsCluster = new ecs.Cluster(this, 'CodeFlowCluster', {
            clusterName: `codeflow-workers-${environmentName}`,
            vpc: this.vpc,
            containerInsights: true, // Enable CloudWatch Container Insights for monitoring
        });
        cdk.Tags.of(this.ecsCluster).add('Name', `codeflow-workers-${environmentName}`);
        cdk.Tags.of(this.ecsCluster).add('Environment', environmentName);
        // Create ECR Repository for Docker images
        this.ecrRepository = new ecr.Repository(this, 'CodeFlowWorkersRepository', {
            repositoryName: `codeflow-workers-${environmentName}`,
            imageScanOnPush: true, // Enable automatic image scanning for vulnerabilities
            imageTagMutability: ecr.TagMutability.MUTABLE,
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep images even if stack is deleted
            lifecycleRules: [
                {
                    description: 'Remove untagged images after 7 days',
                    tagStatus: ecr.TagStatus.UNTAGGED,
                    maxImageAge: cdk.Duration.days(7),
                    rulePriority: 1,
                },
                {
                    description: 'Keep last 10 images',
                    maxImageCount: 10,
                    // No rulePriority - will be auto-assigned as highest (TagStatus.ANY must be last)
                },
            ],
        });
        cdk.Tags.of(this.ecrRepository).add('Name', `codeflow-workers-${environmentName}`);
        cdk.Tags.of(this.ecrRepository).add('Environment', environmentName);
        // Create ECS Task Execution Role (for pulling images and writing logs)
        this.ecsExecutionRole = new iam.Role(this, 'ECSExecutionRole', {
            roleName: `codeflow-ecs-execution-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'ECS task execution role for pulling images and writing logs',
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
            ],
        });
        // Grant ECR permissions to execution role
        this.ecrRepository.grantPull(this.ecsExecutionRole);
        // Grant CloudWatch Logs permissions
        ecsLogGroup.grantWrite(this.ecsExecutionRole);
        cdk.Tags.of(this.ecsExecutionRole).add('Name', `codeflow-ecs-execution-role-${environmentName}`);
        cdk.Tags.of(this.ecsExecutionRole).add('Environment', environmentName);
        // Create ECS Task Role (for application permissions: Bedrock, DynamoDB, S3)
        this.ecsTaskRole = new iam.Role(this, 'ECSTaskRole', {
            roleName: `codeflow-ecs-task-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            description: 'ECS task role for weakness analysis worker with Bedrock and DynamoDB permissions',
        });
        // Grant DynamoDB permissions
        this.usersTable.grantReadWriteData(this.ecsTaskRole);
        this.learningPathsTable.grantReadWriteData(this.ecsTaskRole);
        this.progressTable.grantReadData(this.ecsTaskRole);
        this.llmCacheTable.grantReadWriteData(this.ecsTaskRole);
        // Grant S3 permissions
        this.datasetsBucket.grantReadWrite(this.ecsTaskRole);
        // Grant Bedrock permissions
        this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
            ],
            resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
                `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
            ],
        }));
        // Grant AWS Marketplace permissions for Bedrock model access
        this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'aws-marketplace:ViewSubscriptions',
                'aws-marketplace:Subscribe',
            ],
            resources: ['*'],
        }));
        // Grant X-Ray permissions
        this.ecsTaskRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
            ],
            resources: ['*'],
        }));
        // Grant SQS permissions (to receive messages from background jobs queue)
        this.backgroundJobsQueue.grantConsumeMessages(this.ecsTaskRole);
        cdk.Tags.of(this.ecsTaskRole).add('Name', `codeflow-ecs-task-role-${environmentName}`);
        cdk.Tags.of(this.ecsTaskRole).add('Environment', environmentName);
        // Create Fargate Task Definition for Weakness Analysis
        this.ecsTaskDefinition = new ecs.FargateTaskDefinition(this, 'WeaknessAnalysisTaskDefinition', {
            family: `codeflow-weakness-analysis-${environmentName}`,
            cpu: 2048, // 2 vCPU
            memoryLimitMiB: 4096, // 4GB RAM
            taskRole: this.ecsTaskRole,
            executionRole: this.ecsExecutionRole,
        });
        cdk.Tags.of(this.ecsTaskDefinition).add('Name', `codeflow-weakness-analysis-${environmentName}`);
        cdk.Tags.of(this.ecsTaskDefinition).add('Environment', environmentName);
        // Add container to task definition
        const weaknessAnalysisContainer = this.ecsTaskDefinition.addContainer('weakness-analyzer', {
            containerName: 'weakness-analyzer',
            image: ecs.ContainerImage.fromEcrRepository(this.ecrRepository, 'latest' // Will be updated during deployment
            ),
            essential: true,
            environment: {
                ...commonEnvironment,
                WORKER_TYPE: 'weakness-analysis',
            },
            logging: ecs.LogDrivers.awsLogs({
                streamPrefix: 'weakness-analysis',
                logGroup: ecsLogGroup,
            }),
            healthCheck: {
                command: ['CMD-SHELL', 'echo "healthy" || exit 1'],
                interval: cdk.Duration.seconds(30),
                timeout: cdk.Duration.seconds(5),
                retries: 3,
                startPeriod: cdk.Duration.seconds(60),
            },
        });
        // Add EventBridge target for Profile Analysis Complete event
        // Update the existing rule to include ECS task as target
        profileAnalysisCompleteRule.addTarget(new targets.EcsTask({
            cluster: this.ecsCluster,
            taskDefinition: this.ecsTaskDefinition,
            taskCount: 1,
            subnetSelection: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            securityGroups: [this.ecsSecurityGroup],
            containerOverrides: [
                {
                    containerName: 'weakness-analyzer',
                    environment: [
                        {
                            name: 'EVENT_TYPE',
                            value: 'ProfileAnalysisComplete',
                        },
                    ],
                },
            ],
            deadLetterQueue: this.deadLetterQueue,
            maxEventAge: cdk.Duration.hours(2),
            retryAttempts: 2,
        }));
        // Grant EventBridge permissions to run ECS tasks
        this.ecsTaskRole.grantPassRole(new iam.ServicePrincipal('events.amazonaws.com'));
        this.ecsExecutionRole.grantPassRole(new iam.ServicePrincipal('events.amazonaws.com'));
        // Grant EventBridge permissions to run tasks in the cluster
        const eventBridgeEcsRole = new iam.Role(this, 'EventBridgeECSRole', {
            roleName: `codeflow-eventbridge-ecs-role-${environmentName}`,
            assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
            description: 'IAM role for EventBridge to run ECS tasks',
        });
        eventBridgeEcsRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'ecs:RunTask',
            ],
            resources: [this.ecsTaskDefinition.taskDefinitionArn],
            conditions: {
                ArnLike: {
                    'ecs:cluster': this.ecsCluster.clusterArn,
                },
            },
        }));
        eventBridgeEcsRole.addToPolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'iam:PassRole',
            ],
            resources: [
                this.ecsTaskRole.roleArn,
                this.ecsExecutionRole.roleArn,
            ],
        }));
        // ========================================
        // ECS Auto-Scaling Configuration
        // ========================================
        // Note: Auto-scaling for ECS Fargate tasks triggered by EventBridge is handled differently
        // than traditional service-based auto-scaling. Since tasks are triggered by events,
        // we rely on EventBridge's built-in concurrency and the SQS queue depth.
        // 
        // For SQS-based scaling (0-10 tasks based on queue depth), we would need to:
        // 1. Create an ECS Service (not just task definition)
        // 2. Configure the service to poll SQS
        // 3. Set up target tracking scaling based on SQS ApproximateNumberOfMessagesVisible
        //
        // However, since the design specifies EventBridge-triggered tasks, we'll document
        // the scaling approach in the outputs and comments.
        //
        // Alternative approach: Use Lambda to monitor SQS depth and trigger ECS tasks
        // This would be implemented in a future task if needed.
        // ========================================
        // CloudWatch Dashboards and Alarms
        // ========================================
        // Create SNS topic for alarm notifications
        const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
            topicName: `codeflow-alarms-${environmentName}`,
            displayName: 'CodeFlow Platform Alarms',
        });
        cdk.Tags.of(alarmTopic).add('Name', `codeflow-alarms-${environmentName}`);
        cdk.Tags.of(alarmTopic).add('Environment', environmentName);
        // ========================================
        // 1. GenAI Performance Dashboard
        // ========================================
        const genAIDashboard = new cloudwatch.Dashboard(this, 'GenAIPerformanceDashboard', {
            dashboardName: `CodeFlow-GenAI-Performance-${environmentName}`,
        });
        // Bedrock API Latency Widget
        genAIDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Bedrock API Latency',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'BedrockLatency',
                    statistic: 'Average',
                    label: 'P50 (Average)',
                    period: cdk.Duration.minutes(5),
                }),
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'BedrockLatency',
                    statistic: 'p95',
                    label: 'P95',
                    period: cdk.Duration.minutes(5),
                }),
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'BedrockLatency',
                    statistic: 'p99',
                    label: 'P99',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Milliseconds',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // LLM Cache Performance Widget
        genAIDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'LLM Cache Performance',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'LLMCacheHitRate',
                    statistic: 'Average',
                    label: 'Cache Hit Rate',
                    period: cdk.Duration.minutes(5),
                }),
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'LLMCacheMissRate',
                    statistic: 'Average',
                    label: 'Cache Miss Rate',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Percentage',
                min: 0,
                max: 100,
            },
            width: 12,
            height: 6,
        }));
        // Token Usage & Cost Widget
        genAIDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Token Usage & Cost',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'TokensUsed',
                    statistic: 'Sum',
                    label: 'Total Tokens Used',
                    period: cdk.Duration.hours(1),
                }),
            ],
            right: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'CostPerRequest',
                    statistic: 'Average',
                    label: 'Average Cost per Request',
                    period: cdk.Duration.hours(1),
                }),
            ],
            leftYAxis: {
                label: 'Tokens',
                min: 0,
            },
            rightYAxis: {
                label: 'USD',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // Bedrock Invocation Count Widget
        genAIDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Bedrock Invocations by Model',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/GenAI',
                    metricName: 'BedrockInvocations',
                    statistic: 'Sum',
                    label: 'Total Invocations',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Count',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        cdk.Tags.of(genAIDashboard).add('Name', `CodeFlow-GenAI-Performance-${environmentName}`);
        cdk.Tags.of(genAIDashboard).add('Environment', environmentName);
        // ========================================
        // 2. API Health Dashboard
        // ========================================
        const apiHealthDashboard = new cloudwatch.Dashboard(this, 'APIHealthDashboard', {
            dashboardName: `CodeFlow-API-Health-${environmentName}`,
        });
        // API Request Rate Widget
        apiHealthDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'API Request Rate',
            left: [
                this.restApi.metricCount({
                    statistic: 'Sum',
                    label: 'Total Requests',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Requests',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // API Error Rate Widget
        apiHealthDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'API Error Rate',
            left: [
                this.restApi.metricClientError({
                    statistic: 'Sum',
                    label: '4XX Errors',
                    period: cdk.Duration.minutes(5),
                }),
                this.restApi.metricServerError({
                    statistic: 'Sum',
                    label: '5XX Errors',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Errors',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // API Latency Widget (P50, P95, P99)
        apiHealthDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'API Latency',
            left: [
                this.restApi.metricLatency({
                    statistic: 'Average',
                    label: 'P50 (Average)',
                    period: cdk.Duration.minutes(5),
                }),
                this.restApi.metricLatency({
                    statistic: 'p95',
                    label: 'P95',
                    period: cdk.Duration.minutes(5),
                }),
                this.restApi.metricLatency({
                    statistic: 'p99',
                    label: 'P99',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Milliseconds',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // Lambda Concurrent Executions Widget
        apiHealthDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Lambda Concurrent Executions',
            left: [
                this.authFunction.metricInvocations({
                    statistic: 'Sum',
                    label: 'Auth',
                    period: cdk.Duration.minutes(5),
                }),
                this.analysisFunction.metricInvocations({
                    statistic: 'Sum',
                    label: 'Analysis',
                    period: cdk.Duration.minutes(5),
                }),
                this.recommendationsFunction.metricInvocations({
                    statistic: 'Sum',
                    label: 'Recommendations',
                    period: cdk.Duration.minutes(5),
                }),
                this.chatMentorFunction.metricInvocations({
                    statistic: 'Sum',
                    label: 'Chat Mentor',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Invocations',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // DynamoDB Throttling Events Widget
        apiHealthDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'DynamoDB Throttling Events',
            left: [
                this.usersTable.metricUserErrors({
                    statistic: 'Sum',
                    label: 'Users Table',
                    period: cdk.Duration.minutes(5),
                }),
                this.learningPathsTable.metricUserErrors({
                    statistic: 'Sum',
                    label: 'Learning Paths Table',
                    period: cdk.Duration.minutes(5),
                }),
                this.progressTable.metricUserErrors({
                    statistic: 'Sum',
                    label: 'Progress Table',
                    period: cdk.Duration.minutes(5),
                }),
                this.llmCacheTable.metricUserErrors({
                    statistic: 'Sum',
                    label: 'LLM Cache Table',
                    period: cdk.Duration.minutes(5),
                }),
            ],
            leftYAxis: {
                label: 'Throttled Requests',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        cdk.Tags.of(apiHealthDashboard).add('Name', `CodeFlow-API-Health-${environmentName}`);
        cdk.Tags.of(apiHealthDashboard).add('Environment', environmentName);
        // ========================================
        // 3. User Engagement Dashboard
        // ========================================
        const userEngagementDashboard = new cloudwatch.Dashboard(this, 'UserEngagementDashboard', {
            dashboardName: `CodeFlow-User-Engagement-${environmentName}`,
        });
        // Daily Active Users Widget
        userEngagementDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Daily Active Users (DAU)',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/Business',
                    metricName: 'DailyActiveUsers',
                    statistic: 'Sum',
                    label: 'DAU',
                    period: cdk.Duration.days(1),
                }),
            ],
            leftYAxis: {
                label: 'Users',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // Problems Solved Widget
        userEngagementDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Problems Solved per Day',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/Business',
                    metricName: 'ProblemsSolved',
                    statistic: 'Sum',
                    label: 'Problems Solved',
                    period: cdk.Duration.days(1),
                }),
            ],
            leftYAxis: {
                label: 'Count',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // Learning Paths Generated Widget
        userEngagementDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Learning Paths Generated',
            left: [
                new cloudwatch.Metric({
                    namespace: 'CodeFlow/Business',
                    metricName: 'LearningPathsGenerated',
                    statistic: 'Sum',
                    label: 'Paths Generated',
                    period: cdk.Duration.days(1),
                }),
            ],
            leftYAxis: {
                label: 'Count',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        // Chat Mentor Conversations Widget
        userEngagementDashboard.addWidgets(new cloudwatch.GraphWidget({
            title: 'Chat Mentor Conversations',
            left: [
                this.chatMentorFunction.metricInvocations({
                    statistic: 'Sum',
                    label: 'Total Conversations',
                    period: cdk.Duration.hours(1),
                }),
            ],
            leftYAxis: {
                label: 'Count',
                min: 0,
            },
            width: 12,
            height: 6,
        }));
        cdk.Tags.of(userEngagementDashboard).add('Name', `CodeFlow-User-Engagement-${environmentName}`);
        cdk.Tags.of(userEngagementDashboard).add('Environment', environmentName);
        // ========================================
        // CloudWatch Alarms
        // ========================================
        // Alarm 1: API Error Rate > 5% for 5 minutes
        const apiErrorRateAlarm = new cloudwatch.Alarm(this, 'APIErrorRateAlarm', {
            alarmName: `CodeFlow-API-ErrorRate-${environmentName}`,
            alarmDescription: 'Alert when API error rate exceeds 5% for 5 minutes',
            metric: this.restApi.metricServerError({
                statistic: 'Sum',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 10, // 10 errors in 5 minutes (assuming ~200 requests = 5%)
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        apiErrorRateAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        cdk.Tags.of(apiErrorRateAlarm).add('Name', `CodeFlow-API-ErrorRate-${environmentName}`);
        cdk.Tags.of(apiErrorRateAlarm).add('Environment', environmentName);
        // Alarm 2: Bedrock Latency > 10s (P95)
        const bedrockLatencyAlarm = new cloudwatch.Alarm(this, 'BedrockLatencyAlarm', {
            alarmName: `CodeFlow-Bedrock-HighLatency-${environmentName}`,
            alarmDescription: 'Alert when Bedrock P95 latency exceeds 10 seconds',
            metric: new cloudwatch.Metric({
                namespace: 'CodeFlow/GenAI',
                metricName: 'BedrockLatency',
                statistic: 'p95',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 10000, // 10 seconds in milliseconds
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        bedrockLatencyAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        cdk.Tags.of(bedrockLatencyAlarm).add('Name', `CodeFlow-Bedrock-HighLatency-${environmentName}`);
        cdk.Tags.of(bedrockLatencyAlarm).add('Environment', environmentName);
        // Alarm 3: DynamoDB Throttling Events
        const dynamoDBThrottlingAlarm = new cloudwatch.Alarm(this, 'DynamoDBThrottlingAlarm', {
            alarmName: `CodeFlow-DynamoDB-Throttling-${environmentName}`,
            alarmDescription: 'Alert when DynamoDB throttling events occur',
            metric: new cloudwatch.MathExpression({
                expression: 'm1 + m2 + m3 + m4',
                usingMetrics: {
                    m1: this.usersTable.metricUserErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
                    m2: this.learningPathsTable.metricUserErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
                    m3: this.progressTable.metricUserErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
                    m4: this.llmCacheTable.metricUserErrors({ statistic: 'Sum', period: cdk.Duration.minutes(5) }),
                },
                label: 'Total DynamoDB Throttling Events',
                period: cdk.Duration.minutes(5),
            }),
            threshold: 5, // Alert if more than 5 throttling events in 5 minutes
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        dynamoDBThrottlingAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        cdk.Tags.of(dynamoDBThrottlingAlarm).add('Name', `CodeFlow-DynamoDB-Throttling-${environmentName}`);
        cdk.Tags.of(dynamoDBThrottlingAlarm).add('Environment', environmentName);
        // Alarm 4: Lambda Concurrent Executions > 800
        const lambdaConcurrentExecutionsAlarm = new cloudwatch.Alarm(this, 'LambdaConcurrentExecutionsAlarm', {
            alarmName: `CodeFlow-Lambda-HighConcurrency-${environmentName}`,
            alarmDescription: 'Alert when Lambda concurrent executions exceed 800',
            metric: new cloudwatch.MathExpression({
                expression: 'm1 + m2 + m3 + m4 + m5',
                usingMetrics: {
                    m1: this.authFunction.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(1) }),
                    m2: this.analysisFunction.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(1) }),
                    m3: this.recommendationsFunction.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(1) }),
                    m4: this.chatMentorFunction.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(1) }),
                    m5: this.scrapingFunction.metricInvocations({ statistic: 'Sum', period: cdk.Duration.minutes(1) }),
                },
                label: 'Total Lambda Invocations',
                period: cdk.Duration.minutes(1),
            }),
            threshold: 800,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        lambdaConcurrentExecutionsAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        cdk.Tags.of(lambdaConcurrentExecutionsAlarm).add('Name', `CodeFlow-Lambda-HighConcurrency-${environmentName}`);
        cdk.Tags.of(lambdaConcurrentExecutionsAlarm).add('Environment', environmentName);
        // Alarm 5: ECS Task Failures > 3 in 10 minutes
        const ecsTaskFailuresAlarm = new cloudwatch.Alarm(this, 'ECSTaskFailuresAlarm', {
            alarmName: `CodeFlow-ECS-TaskFailures-${environmentName}`,
            alarmDescription: 'Alert when ECS task failures exceed 3 in 10 minutes',
            metric: new cloudwatch.Metric({
                namespace: 'AWS/ECS',
                metricName: 'TasksFailed',
                dimensionsMap: {
                    ClusterName: this.ecsCluster.clusterName,
                },
                statistic: 'Sum',
                period: cdk.Duration.minutes(10),
            }),
            threshold: 3,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        ecsTaskFailuresAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        cdk.Tags.of(ecsTaskFailuresAlarm).add('Name', `CodeFlow-ECS-TaskFailures-${environmentName}`);
        cdk.Tags.of(ecsTaskFailuresAlarm).add('Environment', environmentName);
        // Alarm 6: Low Cache Hit Rate < 40%
        const lowCacheHitRateAlarm = new cloudwatch.Alarm(this, 'LowCacheHitRateAlarm', {
            alarmName: `CodeFlow-LLM-LowCacheHitRate-${environmentName}`,
            alarmDescription: 'Alert when LLM cache hit rate falls below 40%',
            metric: new cloudwatch.Metric({
                namespace: 'CodeFlow/GenAI',
                metricName: 'LLMCacheHitRate',
                statistic: 'Average',
                period: cdk.Duration.hours(1),
            }),
            threshold: 40, // Below 40% hit rate
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });
        lowCacheHitRateAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
        cdk.Tags.of(lowCacheHitRateAlarm).add('Name', `CodeFlow-LLM-LowCacheHitRate-${environmentName}`);
        cdk.Tags.of(lowCacheHitRateAlarm).add('Environment', environmentName);
        // ========================================
        // API Gateway Lambda Integrations
        // ========================================
        // Interview Simulator API endpoints
        const interviewIntegration = new apigateway.LambdaIntegration(this.interviewSimulatorFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'*'",
                    },
                },
            ],
        });
        // POST /interview/start
        const startResource = interviewResource.addResource('start');
        startResource.addMethod('POST', interviewIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // POST /interview/submit
        const submitResource = interviewResource.addResource('submit');
        submitResource.addMethod('POST', interviewIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // POST /interview/behavioral
        const behavioralResource = interviewResource.addResource('behavioral');
        behavioralResource.addMethod('POST', interviewIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // GET /interview/{session_id}/feedback
        const sessionIdResource = interviewResource.addResource('{session_id}');
        const feedbackResource = sessionIdResource.addResource('feedback');
        feedbackResource.addMethod('GET', interviewIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // GET /interview/{session_id}/status
        const statusResource = sessionIdResource.addResource('status');
        statusResource.addMethod('GET', interviewIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // ========================================
        // Auth API endpoints
        // ========================================
        const authIntegration = new apigateway.LambdaIntegration(this.authFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'*'",
                    },
                },
            ],
        });
        // POST /auth/register
        const registerResource = authResource.addResource('register');
        registerResource.addMethod('POST', authIntegration, {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // POST /auth/login
        const loginResource = authResource.addResource('login');
        loginResource.addMethod('POST', authIntegration, {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // POST /auth/refresh
        const refreshResource = authResource.addResource('refresh');
        refreshResource.addMethod('POST', authIntegration, {
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // ========================================
        // Analysis API endpoints
        // ========================================
        const analysisIntegration = new apigateway.LambdaIntegration(this.analysisFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'*'",
                    },
                },
            ],
        });
        // GET /analyze/{user_id}/topics
        const userIdResource = analyzeResource.addResource('{user_id}');
        const topicsResource = userIdResource.addResource('topics');
        topicsResource.addMethod('GET', analysisIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // POST /analyze/profile
        const profileResource = analyzeResource.addResource('profile');
        profileResource.addMethod('POST', analysisIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // ========================================
        // Progress API endpoints
        // ========================================
        const progressIntegration = new apigateway.LambdaIntegration(this.analysisFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'*'",
                    },
                },
            ],
        });
        // GET /progress/{user_id}
        const progressUserIdResource = progressResource.addResource('{user_id}');
        progressUserIdResource.addMethod('GET', progressIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // ========================================
        // Recommendations API endpoints
        // ========================================
        const recommendationsIntegration = new apigateway.LambdaIntegration(this.recommendationsFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'*'",
                    },
                },
            ],
        });
        // POST /recommendations/generate-path
        const generatePathResource = recommendationsResource.addResource('generate-path');
        generatePathResource.addMethod('POST', recommendationsIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // GET /recommendations/next-problem
        const nextProblemResource = recommendationsResource.addResource('next-problem');
        nextProblemResource.addMethod('GET', recommendationsIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // POST /recommendations/hint
        const hintResource = recommendationsResource.addResource('hint');
        hintResource.addMethod('POST', recommendationsIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // ========================================
        // Chat Mentor API endpoints
        // ========================================
        const chatMentorIntegration = new apigateway.LambdaIntegration(this.chatMentorFunction, {
            proxy: true,
            integrationResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': "'*'",
                    },
                },
            ],
        });
        // Create /chat-mentor resource
        const chatMentorResource = this.restApi.root.addResource('chat-mentor');
        // POST /chat-mentor
        chatMentorResource.addMethod('POST', chatMentorIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // GET /chat-mentor/{user_id}/history
        const chatMentorUserIdResource = chatMentorResource.addResource('{user_id}');
        const historyResource = chatMentorUserIdResource.addResource('history');
        historyResource.addMethod('GET', chatMentorIntegration, {
            authorizer: this.jwtAuthorizer,
            methodResponses: [
                {
                    statusCode: '200',
                    responseParameters: {
                        'method.response.header.Access-Control-Allow-Origin': true,
                    },
                },
            ],
        });
        // ========================================
        // Stack Outputs
        // ========================================
        new cdk.CfnOutput(this, 'VPCId', {
            value: this.vpc.vpcId,
            description: 'VPC ID',
            exportName: `CodeFlow-VPC-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'VPCCidr', {
            value: this.vpc.vpcCidrBlock,
            description: 'VPC CIDR Block',
        });
        new cdk.CfnOutput(this, 'PublicSubnets', {
            value: this.vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
            description: 'Public Subnet IDs',
            exportName: `CodeFlow-PublicSubnets-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'PrivateSubnets', {
            value: this.vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
            description: 'Private Subnet IDs',
            exportName: `CodeFlow-PrivateSubnets-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'IsolatedSubnets', {
            value: this.vpc.isolatedSubnets.map(subnet => subnet.subnetId).join(','),
            description: 'Isolated Subnet IDs',
            exportName: `CodeFlow-IsolatedSubnets-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'LambdaSecurityGroupId', {
            value: this.lambdaSecurityGroup.securityGroupId,
            description: 'Lambda Security Group ID',
            exportName: `CodeFlow-LambdaSG-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'OpenSearchSecurityGroupId', {
            value: this.openSearchSecurityGroup.securityGroupId,
            description: 'OpenSearch Security Group ID',
            exportName: `CodeFlow-OpenSearchSG-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECSSecurityGroupId', {
            value: this.ecsSecurityGroup.securityGroupId,
            description: 'ECS Security Group ID',
            exportName: `CodeFlow-ECSSG-${environmentName}`,
        });
        // ========================================
        // Environment Configuration Output
        // ========================================
        new cdk.CfnOutput(this, 'Environment', {
            value: environmentName,
            description: 'Deployment Environment',
        });
        new cdk.CfnOutput(this, 'Region', {
            value: this.region,
            description: 'AWS Region',
        });
        new cdk.CfnOutput(this, 'Account', {
            value: this.account,
            description: 'AWS Account ID',
        });
        // ========================================
        // DynamoDB Table Outputs
        // ========================================
        new cdk.CfnOutput(this, 'UsersTableName', {
            value: this.usersTable.tableName,
            description: 'Users Table Name',
            exportName: `CodeFlow-UsersTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'UsersTableArn', {
            value: this.usersTable.tableArn,
            description: 'Users Table ARN',
        });
        new cdk.CfnOutput(this, 'LearningPathsTableName', {
            value: this.learningPathsTable.tableName,
            description: 'Learning Paths Table Name',
            exportName: `CodeFlow-LearningPathsTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'LearningPathsTableArn', {
            value: this.learningPathsTable.tableArn,
            description: 'Learning Paths Table ARN',
        });
        new cdk.CfnOutput(this, 'ProgressTableName', {
            value: this.progressTable.tableName,
            description: 'Progress Table Name',
            exportName: `CodeFlow-ProgressTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ProgressTableArn', {
            value: this.progressTable.tableArn,
            description: 'Progress Table ARN',
        });
        new cdk.CfnOutput(this, 'LLMCacheTableName', {
            value: this.llmCacheTable.tableName,
            description: 'LLM Cache Table Name',
            exportName: `CodeFlow-LLMCacheTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'LLMCacheTableArn', {
            value: this.llmCacheTable.tableArn,
            description: 'LLM Cache Table ARN',
        });
        new cdk.CfnOutput(this, 'ConversationHistoryTableName', {
            value: this.conversationHistoryTable.tableName,
            description: 'Conversation History Table Name',
            exportName: `CodeFlow-ConversationHistoryTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ConversationHistoryTableArn', {
            value: this.conversationHistoryTable.tableArn,
            description: 'Conversation History Table ARN',
        });
        new cdk.CfnOutput(this, 'KnowledgeBaseTableName', {
            value: this.knowledgeBaseTable.tableName,
            description: 'Knowledge Base Table Name',
            exportName: `CodeFlow-KnowledgeBaseTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'KnowledgeBaseTableArn', {
            value: this.knowledgeBaseTable.tableArn,
            description: 'Knowledge Base Table ARN',
        });
        new cdk.CfnOutput(this, 'AnalyticsTableName', {
            value: this.analyticsTable.tableName,
            description: 'Analytics Table Name',
            exportName: `CodeFlow-AnalyticsTable-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'AnalyticsTableArn', {
            value: this.analyticsTable.tableArn,
            description: 'Analytics Table ARN',
        });
        // ========================================
        // S3 Bucket Outputs
        // ========================================
        new cdk.CfnOutput(this, 'StaticAssetsBucketName', {
            value: this.staticAssetsBucket.bucketName,
            description: 'Static Assets Bucket Name',
            exportName: `CodeFlow-StaticAssetsBucket-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'StaticAssetsBucketArn', {
            value: this.staticAssetsBucket.bucketArn,
            description: 'Static Assets Bucket ARN',
        });
        new cdk.CfnOutput(this, 'KBDocumentsBucketName', {
            value: this.kbDocumentsBucket.bucketName,
            description: 'Knowledge Base Documents Bucket Name',
            exportName: `CodeFlow-KBDocumentsBucket-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'KBDocumentsBucketArn', {
            value: this.kbDocumentsBucket.bucketArn,
            description: 'Knowledge Base Documents Bucket ARN',
        });
        new cdk.CfnOutput(this, 'DatasetsBucketName', {
            value: this.datasetsBucket.bucketName,
            description: 'Datasets Bucket Name',
            exportName: `CodeFlow-DatasetsBucket-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'DatasetsBucketArn', {
            value: this.datasetsBucket.bucketArn,
            description: 'Datasets Bucket ARN',
        });
        // ========================================
        // OpenSearch Domain Outputs
        // ========================================
        new cdk.CfnOutput(this, 'OpenSearchDomainName', {
            value: this.openSearchDomain.domainName,
            description: 'OpenSearch Domain Name',
            exportName: `CodeFlow-OpenSearchDomain-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'OpenSearchDomainArn', {
            value: this.openSearchDomain.domainArn,
            description: 'OpenSearch Domain ARN',
        });
        new cdk.CfnOutput(this, 'OpenSearchDomainEndpoint', {
            value: this.openSearchDomain.domainEndpoint,
            description: 'OpenSearch Domain Endpoint',
            exportName: `CodeFlow-OpenSearchEndpoint-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'OpenSearchDashboardsUrl', {
            value: `https://${this.openSearchDomain.domainEndpoint}/_dashboards`,
            description: 'OpenSearch Dashboards URL',
        });
        // ========================================
        // API Gateway Outputs
        // ========================================
        new cdk.CfnOutput(this, 'RestApiId', {
            value: this.restApi.restApiId,
            description: 'REST API Gateway ID',
            exportName: `CodeFlow-RestApiId-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'RestApiUrl', {
            value: this.restApi.url,
            description: 'REST API Gateway URL',
            exportName: `CodeFlow-RestApiUrl-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'RestApiRootResourceId', {
            value: this.restApi.root.resourceId,
            description: 'REST API Root Resource ID',
            exportName: `CodeFlow-RestApiRootResourceId-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'JWTAuthorizerArn', {
            value: this.jwtAuthorizer.authorizerArn,
            description: 'JWT Lambda Authorizer ARN',
            exportName: `CodeFlow-JWTAuthorizerArn-${environmentName}`,
        });
        // ========================================
        // Lambda Function Outputs
        // ========================================
        new cdk.CfnOutput(this, 'SharedDependenciesLayerArn', {
            value: this.sharedDependenciesLayer.layerVersionArn,
            description: 'Shared Dependencies Lambda Layer ARN',
            exportName: `CodeFlow-SharedDependenciesLayer-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'AuthFunctionName', {
            value: this.authFunction.functionName,
            description: 'Auth Lambda Function Name',
            exportName: `CodeFlow-AuthFunction-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'AuthFunctionArn', {
            value: this.authFunction.functionArn,
            description: 'Auth Lambda Function ARN',
        });
        new cdk.CfnOutput(this, 'AnalysisFunctionName', {
            value: this.analysisFunction.functionName,
            description: 'Analysis Lambda Function Name',
            exportName: `CodeFlow-AnalysisFunction-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'AnalysisFunctionArn', {
            value: this.analysisFunction.functionArn,
            description: 'Analysis Lambda Function ARN',
        });
        new cdk.CfnOutput(this, 'RecommendationsFunctionName', {
            value: this.recommendationsFunction.functionName,
            description: 'Recommendations Lambda Function Name',
            exportName: `CodeFlow-RecommendationsFunction-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'RecommendationsFunctionArn', {
            value: this.recommendationsFunction.functionArn,
            description: 'Recommendations Lambda Function ARN',
        });
        new cdk.CfnOutput(this, 'ChatMentorFunctionName', {
            value: this.chatMentorFunction.functionName,
            description: 'Chat Mentor Lambda Function Name',
            exportName: `CodeFlow-ChatMentorFunction-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ChatMentorFunctionArn', {
            value: this.chatMentorFunction.functionArn,
            description: 'Chat Mentor Lambda Function ARN',
        });
        new cdk.CfnOutput(this, 'ScrapingFunctionName', {
            value: this.scrapingFunction.functionName,
            description: 'Scraping Lambda Function Name',
            exportName: `CodeFlow-ScrapingFunction-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ScrapingFunctionArn', {
            value: this.scrapingFunction.functionArn,
            description: 'Scraping Lambda Function ARN',
        });
        // ========================================
        // EventBridge Outputs
        // ========================================
        new cdk.CfnOutput(this, 'EventBusName', {
            value: this.eventBus.eventBusName,
            description: 'EventBridge Event Bus Name',
            exportName: `CodeFlow-EventBus-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'EventBusArn', {
            value: this.eventBus.eventBusArn,
            description: 'EventBridge Event Bus ARN',
        });
        // ========================================
        // SQS Queue Outputs
        // ========================================
        new cdk.CfnOutput(this, 'BackgroundJobsQueueName', {
            value: this.backgroundJobsQueue.queueName,
            description: 'Background Jobs Queue Name',
            exportName: `CodeFlow-BackgroundJobsQueue-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'BackgroundJobsQueueArn', {
            value: this.backgroundJobsQueue.queueArn,
            description: 'Background Jobs Queue ARN',
        });
        new cdk.CfnOutput(this, 'BackgroundJobsQueueUrl', {
            value: this.backgroundJobsQueue.queueUrl,
            description: 'Background Jobs Queue URL',
            exportName: `CodeFlow-BackgroundJobsQueueUrl-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'DeadLetterQueueName', {
            value: this.deadLetterQueue.queueName,
            description: 'Dead Letter Queue Name',
            exportName: `CodeFlow-DeadLetterQueue-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'DeadLetterQueueArn', {
            value: this.deadLetterQueue.queueArn,
            description: 'Dead Letter Queue ARN',
        });
        new cdk.CfnOutput(this, 'DeadLetterQueueUrl', {
            value: this.deadLetterQueue.queueUrl,
            description: 'Dead Letter Queue URL',
            exportName: `CodeFlow-DeadLetterQueueUrl-${environmentName}`,
        });
        // ========================================
        // ECS Fargate Outputs
        // ========================================
        new cdk.CfnOutput(this, 'ECSClusterName', {
            value: this.ecsCluster.clusterName,
            description: 'ECS Cluster Name',
            exportName: `CodeFlow-ECSCluster-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECSClusterArn', {
            value: this.ecsCluster.clusterArn,
            description: 'ECS Cluster ARN',
        });
        new cdk.CfnOutput(this, 'ECRRepositoryName', {
            value: this.ecrRepository.repositoryName,
            description: 'ECR Repository Name',
            exportName: `CodeFlow-ECRRepository-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECRRepositoryUri', {
            value: this.ecrRepository.repositoryUri,
            description: 'ECR Repository URI',
            exportName: `CodeFlow-ECRRepositoryUri-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECSTaskDefinitionArn', {
            value: this.ecsTaskDefinition.taskDefinitionArn,
            description: 'ECS Task Definition ARN',
            exportName: `CodeFlow-ECSTaskDefinition-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECSTaskRoleArn', {
            value: this.ecsTaskRole.roleArn,
            description: 'ECS Task Role ARN',
            exportName: `CodeFlow-ECSTaskRole-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECSExecutionRoleArn', {
            value: this.ecsExecutionRole.roleArn,
            description: 'ECS Execution Role ARN',
            exportName: `CodeFlow-ECSExecutionRole-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'ECSLogGroupName', {
            value: `/ecs/codeflow-workers-${environmentName}`,
            description: 'ECS CloudWatch Log Group Name',
            exportName: `CodeFlow-ECSLogGroup-${environmentName}`,
        });
        // ========================================
        // Bedrock Knowledge Base Outputs
        // ========================================
        // TODO: Temporarily disabled - depends on Bedrock Knowledge Base
        /*
        new cdk.CfnOutput(this, 'BedrockKnowledgeBaseId', {
          value: this.bedrockKnowledgeBase.attrKnowledgeBaseId,
          description: 'Bedrock Knowledge Base ID',
          exportName: `CodeFlow-BedrockKnowledgeBaseId-${environmentName}`,
        });
    
        new cdk.CfnOutput(this, 'BedrockKnowledgeBaseName', {
          value: this.bedrockKnowledgeBase.name,
          description: 'Bedrock Knowledge Base Name',
        });
    
        new cdk.CfnOutput(this, 'BedrockKnowledgeBaseArn', {
          value: this.bedrockKnowledgeBase.attrKnowledgeBaseArn,
          description: 'Bedrock Knowledge Base ARN',
          exportName: `CodeFlow-BedrockKnowledgeBaseArn-${environmentName}`,
        });
    
        new cdk.CfnOutput(this, 'BedrockDataSourceId', {
          value: this.bedrockDataSource.attrDataSourceId,
          description: 'Bedrock Data Source ID',
          exportName: `CodeFlow-BedrockDataSourceId-${environmentName}`,
        });
    
        new cdk.CfnOutput(this, 'BedrockDataSourceName', {
          value: this.bedrockDataSource.name,
          description: 'Bedrock Data Source Name',
        });
        */
        new cdk.CfnOutput(this, 'BedrockKnowledgeBaseRoleArn', {
            value: this.bedrockKnowledgeBaseRole.roleArn,
            description: 'Bedrock Knowledge Base IAM Role ARN',
            exportName: `CodeFlow-BedrockKnowledgeBaseRoleArn-${environmentName}`,
        });
        // ========================================
        // CloudWatch and SNS Outputs
        // ========================================
        new cdk.CfnOutput(this, 'AlarmTopicArn', {
            value: alarmTopic.topicArn,
            description: 'SNS Topic ARN for CloudWatch Alarms',
            exportName: `CodeFlow-AlarmTopic-${environmentName}`,
        });
        new cdk.CfnOutput(this, 'AlarmTopicName', {
            value: alarmTopic.topicName,
            description: 'SNS Topic Name for CloudWatch Alarms',
        });
        new cdk.CfnOutput(this, 'GenAIDashboardName', {
            value: genAIDashboard.dashboardName,
            description: 'GenAI Performance Dashboard Name',
        });
        new cdk.CfnOutput(this, 'APIHealthDashboardName', {
            value: apiHealthDashboard.dashboardName,
            description: 'API Health Dashboard Name',
        });
        new cdk.CfnOutput(this, 'UserEngagementDashboardName', {
            value: userEngagementDashboard.dashboardName,
            description: 'User Engagement Dashboard Name',
        });
        new cdk.CfnOutput(this, 'CloudWatchDashboardsUrl', {
            value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:`,
            description: 'CloudWatch Dashboards Console URL',
        });
        new cdk.CfnOutput(this, 'CloudWatchAlarmsUrl', {
            value: `https://console.aws.amazon.com/cloudwatch/home?region=${this.region}#alarmsV2:`,
            description: 'CloudWatch Alarms Console URL',
        });
    }
}
exports.CodeFlowInfrastructureStack = CodeFlowInfrastructureStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWZsb3ctaW5mcmFzdHJ1Y3R1cmUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJjb2RlZmxvdy1pbmZyYXN0cnVjdHVyZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFFbkMseURBQTJDO0FBQzNDLDJEQUE2QztBQUM3QyxtRUFBcUQ7QUFDckQsdURBQXlDO0FBQ3pDLDhFQUFnRTtBQUNoRSx5REFBMkM7QUFDM0MsdUVBQXlEO0FBQ3pELCtEQUFpRDtBQUNqRCwrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MseURBQTJDO0FBRTNDLHVFQUF5RDtBQUN6RCx1RkFBeUU7QUFDekUseURBQTJDO0FBTTNDLE1BQWEsMkJBQTRCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUEwRHhELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBdUM7UUFDL0UsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLGVBQWUsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUVsQywyQ0FBMkM7UUFDM0Msb0JBQW9CO1FBQ3BCLDJDQUEyQztRQUUzQyxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQzFDLE9BQU8sRUFBRSxnQkFBZ0IsZUFBZSxFQUFFO1lBQzFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsaURBQWlEO1lBQzVELFdBQVcsRUFBRSxDQUFDLEVBQUUsMkRBQTJEO1lBRTNFLDJCQUEyQjtZQUMzQixXQUFXLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDO1lBRWhELHVCQUF1QjtZQUN2QixtQkFBbUIsRUFBRTtnQkFDbkI7b0JBQ0UsSUFBSSxFQUFFLFFB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LENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzdDLEtBQUssRUFBRSx5REFBeUQsSUFBSSxDQUFDLE1BQU0sWUFBWTtZQUN2RixXQUFXLEVBQUUsK0JBQStCO1NBQzdDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTEyR0Qsa0VBMDJHQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGVjMiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWMyJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0ICogYXMgZHluYW1vZGIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWR5bmFtb2RiJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBvcGVuc2VhcmNoIGZyb20gJ2F3cy1jZGstbGliL2F3cy1vcGVuc2VhcmNoc2VydmljZSc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCAqIGFzIGV2ZW50cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzJztcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcbmltcG9ydCAqIGFzIHNxcyBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3FzJztcbmltcG9ydCAqIGFzIGVjcyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCAqIGFzIGFwcGxpY2F0aW9uYXV0b3NjYWxpbmcgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwcGxpY2F0aW9uYXV0b3NjYWxpbmcnO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoX2FjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3Vkd2F0Y2gtYWN0aW9ucyc7XG5pbXBvcnQgKiBhcyBzbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNucyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZUZsb3dJbmZyYXN0cnVjdHVyZVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50TmFtZTogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgQ29kZUZsb3dJbmZyYXN0cnVjdHVyZVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IHZwYzogZWMyLlZwYztcbiAgcHVibGljIHJlYWRvbmx5IGxhbWJkYVNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgb3BlblNlYXJjaFNlY3VyaXR5R3JvdXA6IGVjMi5TZWN1cml0eUdyb3VwO1xuICBwdWJsaWMgcmVhZG9ubHkgZWNzU2VjdXJpdHlHcm91cDogZWMyLlNlY3VyaXR5R3JvdXA7XG4gIFxuICAvLyBEeW5hbW9EQiBUYWJsZXNcbiAgcHVibGljIHJlYWRvbmx5IHVzZXJzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGVhcm5pbmdQYXRoc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IHByb2dyZXNzVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkgbGxtQ2FjaGVUYWJsZTogZHluYW1vZGIuVGFibGU7XG4gIHB1YmxpYyByZWFkb25seSBjb252ZXJzYXRpb25IaXN0b3J5VGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuICBwdWJsaWMgcmVhZG9ubHkga25vd2xlZGdlQmFzZVRhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGFuYWx5dGljc1RhYmxlOiBkeW5hbW9kYi5UYWJsZTtcbiAgcHVibGljIHJlYWRvbmx5IGludGVydmlld1Nlc3Npb25zVGFibGU6IGR5bmFtb2RiLlRhYmxlO1xuXG4gIC8vIFMzIEJ1Y2tldHNcbiAgcHVibGljIHJlYWRvbmx5IHN0YXRpY0Fzc2V0c0J1Y2tldDogczMuQnVja2V0O1xuICBwdWJsaWMgcmVhZG9ubHkga2JEb2N1bWVudHNCdWNrZXQ6IHMzLkJ1Y2tldDtcbiAgcHVibGljIHJlYWRvbmx5IGRhdGFzZXRzQnVja2V0OiBzMy5CdWNrZXQ7XG5cbiAgLy8gT3BlblNlYXJjaCBEb21haW5cbiAgcHVibGljIHJlYWRvbmx5IG9wZW5TZWFyY2hEb21haW46IG9wZW5zZWFyY2guRG9tYWluO1xuXG4gIC8vIEJlZHJvY2sgS25vd2xlZGdlIEJhc2VcbiAgcHVibGljIHJlYWRvbmx5IGJlZHJvY2tLbm93bGVkZ2VCYXNlOiBjZGsuYXdzX2JlZHJvY2suQ2ZuS25vd2xlZGdlQmFzZTtcbiAgcHVibGljIHJlYWRvbmx5IGJlZHJvY2tEYXRhU291cmNlOiBjZGsuYXdzX2JlZHJvY2suQ2ZuRGF0YVNvdXJjZTtcbiAgcHVibGljIHJlYWRvbmx5IGJlZHJvY2tLbm93bGVkZ2VCYXNlUm9sZTogaWFtLlJvbGU7XG5cbiAgLy8gQVBJIEdhdGV3YXlcbiAgcHVibGljIHJlYWRvbmx5IHJlc3RBcGk6IGFwaWdhdGV3YXkuUmVzdEFwaTtcbiAgcHVibGljIHJlYWRvbmx5IGp3dEF1dGhvcml6ZXI6IGFwaWdhdGV3YXkuUmVxdWVzdEF1dGhvcml6ZXI7XG5cbiAgLy8gTGFtYmRhIExheWVyXG4gIHB1YmxpYyByZWFkb25seSBzaGFyZWREZXBlbmRlbmNpZXNMYXllcjogbGFtYmRhLkxheWVyVmVyc2lvbjtcblxuICAvLyBMYW1iZGEgRnVuY3Rpb25zXG4gIHB1YmxpYyByZWFkb25seSBhdXRoRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IGFuYWx5c2lzRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHJlY29tbWVuZGF0aW9uc0Z1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG4gIHB1YmxpYyByZWFkb25seSBjaGF0TWVudG9yRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IHNjcmFwaW5nRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IGludGVydmlld1NpbXVsYXRvckZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb247XG5cbiAgLy8gRXZlbnRCcmlkZ2VcbiAgcHVibGljIHJlYWRvbmx5IGV2ZW50QnVzOiBldmVudHMuRXZlbnRCdXM7XG5cbiAgLy8gU1FTIFF1ZXVlc1xuICBwdWJsaWMgcmVhZG9ubHkgYmFja2dyb3VuZEpvYnNRdWV1ZTogc3FzLlF1ZXVlO1xuICBwdWJsaWMgcmVhZG9ubHkgZGVhZExldHRlclF1ZXVlOiBzcXMuUXVldWU7XG5cbiAgLy8gRUNTIEZhcmdhdGVcbiAgcHVibGljIHJlYWRvbmx5IGVjc0NsdXN0ZXI6IGVjcy5DbHVzdGVyO1xuICBwdWJsaWMgcmVhZG9ubHkgZWNyUmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHB1YmxpYyByZWFkb25seSBlY3NUYXNrRGVmaW5pdGlvbjogZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbjtcbiAgcHVibGljIHJlYWRvbmx5IGVjc1Rhc2tSb2xlOiBpYW0uUm9sZTtcbiAgcHVibGljIHJlYWRvbmx5IGVjc0V4ZWN1dGlvblJvbGU6IGlhbS5Sb2xlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBDb2RlRmxvd0luZnJhc3RydWN0dXJlU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudE5hbWUgfSA9IHByb3BzO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFZQQyBDb25maWd1cmF0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIHRoaXMudnBjID0gbmV3IGVjMi5WcGModGhpcywgJ0NvZGVGbG93VlBDJywge1xuICAgICAgdnBjTmFtZTogYGNvZGVmbG93LXZwYy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgbWF4QXpzOiAyLCAvLyBVc2UgMiBhdmFpbGFiaWxpdHkgem9uZXMgZm9yIGhpZ2ggYXZhaWxhYmlsaXR5XG4gICAgICBuYXRHYXRld2F5czogMSwgLy8gQ29zdCBvcHRpbWl6YXRpb246IDEgTkFUIEdhdGV3YXkgKGNhbiBpbmNyZWFzZSBmb3IgcHJvZClcbiAgICAgIFxuICAgICAgLy8gSVAgQWRkcmVzcyBDb25maWd1cmF0aW9uXG4gICAgICBpcEFkZHJlc3NlczogZWMyLklwQWRkcmVzc2VzLmNpZHIoJzEwLjAuMC4wLzE2JyksXG4gICAgICBcbiAgICAgIC8vIFN1Ym5ldCBDb25maWd1cmF0aW9uXG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnUHVibGljJyxcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QVUJMSUMsXG4gICAgICAgICAgY2lkck1hc2s6IDI0LCAvLyAxMC4wLjAuMC8yNCwgMTAuMC4xLjAvMjRcbiAgICAgICAgICBtYXBQdWJsaWNJcE9uTGF1bmNoOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ1ByaXZhdGUnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MsXG4gICAgICAgICAgY2lkck1hc2s6IDI0LCAvLyAxMC4wLjIuMC8yNCwgMTAuMC4zLjAvMjRcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdJc29sYXRlZCcsXG4gICAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCxcbiAgICAgICAgICBjaWRyTWFzazogMjQsIC8vIDEwLjAuNC4wLzI0LCAxMC4wLjUuMC8yNCAoZm9yIGRhdGFiYXNlcylcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBcbiAgICAgIC8vIEVuYWJsZSBETlNcbiAgICAgIGVuYWJsZURuc0hvc3RuYW1lczogdHJ1ZSxcbiAgICAgIGVuYWJsZURuc1N1cHBvcnQ6IHRydWUsXG4gICAgICBcbiAgICAgIC8vIFZQQyBGbG93IExvZ3MgZm9yIHNlY3VyaXR5IG1vbml0b3JpbmdcbiAgICAgIGZsb3dMb2dzOiB7XG4gICAgICAgICdDb2RlRmxvd1ZQQ0Zsb3dMb2cnOiB7XG4gICAgICAgICAgZGVzdGluYXRpb246IGVjMi5GbG93TG9nRGVzdGluYXRpb24udG9DbG91ZFdhdGNoTG9ncyhcbiAgICAgICAgICAgIG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdWUENGbG93TG9nR3JvdXAnLCB7XG4gICAgICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvdnBjL2NvZGVmbG93LSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICApLFxuICAgICAgICAgIHRyYWZmaWNUeXBlOiBlYzIuRmxvd0xvZ1RyYWZmaWNUeXBlLkFMTCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgdGFncyB0byBWUENcbiAgICBjZGsuVGFncy5vZih0aGlzLnZwYykuYWRkKCdOYW1lJywgYGNvZGVmbG93LXZwYy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLnZwYykuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU2VjdXJpdHkgR3JvdXBzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gTGFtYmRhIFNlY3VyaXR5IEdyb3VwXG4gICAgdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdMYW1iZGFTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgY29kZWZsb3ctbGFtYmRhLXNnLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBMYW1iZGEgZnVuY3Rpb25zJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsIC8vIExhbWJkYSBuZWVkcyB0byBjYWxsIGV4dGVybmFsIEFQSXMgKExlZXRDb2RlLCBCZWRyb2NrLCBldGMuKVxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctbGFtYmRhLXNnLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuXG4gICAgLy8gT3BlblNlYXJjaCBTZWN1cml0eSBHcm91cFxuICAgIHRoaXMub3BlblNlYXJjaFNlY3VyaXR5R3JvdXAgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ09wZW5TZWFyY2hTZWN1cml0eUdyb3VwJywge1xuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBOYW1lOiBgY29kZWZsb3ctb3BlbnNlYXJjaC1zZy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgT3BlblNlYXJjaCBkb21haW4nLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFsbG93IExhbWJkYSB0byBhY2Nlc3MgT3BlblNlYXJjaCBvbiBwb3J0IDQ0MyAoSFRUUFMpXG4gICAgdGhpcy5vcGVuU2VhcmNoU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIHRoaXMubGFtYmRhU2VjdXJpdHlHcm91cCxcbiAgICAgIGVjMi5Qb3J0LnRjcCg0NDMpLFxuICAgICAgJ0FsbG93IExhbWJkYSB0byBhY2Nlc3MgT3BlblNlYXJjaCdcbiAgICApO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5vcGVuU2VhcmNoU2VjdXJpdHlHcm91cCkuYWRkKCdOYW1lJywgYGNvZGVmbG93LW9wZW5zZWFyY2gtc2ctJHtlbnZpcm9ubWVudE5hbWV9YCk7XG5cbiAgICAvLyBFQ1MgRmFyZ2F0ZSBTZWN1cml0eSBHcm91cFxuICAgIHRoaXMuZWNzU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnRUNTU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICBzZWN1cml0eUdyb3VwTmFtZTogYGNvZGVmbG93LWVjcy1zZy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdTZWN1cml0eSBncm91cCBmb3IgRUNTIEZhcmdhdGUgdGFza3MnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSwgLy8gRUNTIHRhc2tzIG5lZWQgdG8gY2FsbCBCZWRyb2NrLCBEeW5hbW9EQiwgUzNcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuZWNzU2VjdXJpdHlHcm91cCkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWVjcy1zZy0ke2Vudmlyb25tZW50TmFtZX1gKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBWUEMgRW5kcG9pbnRzIChDb3N0IE9wdGltaXphdGlvbilcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgXG4gICAgLy8gUzMgR2F0ZXdheSBFbmRwb2ludCAoRnJlZSAtIG5vIGRhdGEgdHJhbnNmZXIgY2hhcmdlcyB3aXRoaW4gc2FtZSByZWdpb24pXG4gICAgdGhpcy52cGMuYWRkR2F0ZXdheUVuZHBvaW50KCdTM0VuZHBvaW50Jywge1xuICAgICAgc2VydmljZTogZWMyLkdhdGV3YXlWcGNFbmRwb2ludEF3c1NlcnZpY2UuUzMsXG4gICAgICBzdWJuZXRzOiBbXG4gICAgICAgIHsgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyB9LFxuICAgICAgICB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBEeW5hbW9EQiBHYXRld2F5IEVuZHBvaW50IChGcmVlKVxuICAgIHRoaXMudnBjLmFkZEdhdGV3YXlFbmRwb2ludCgnRHluYW1vREJFbmRwb2ludCcsIHtcbiAgICAgIHNlcnZpY2U6IGVjMi5HYXRld2F5VnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkRZTkFNT0RCLFxuICAgICAgc3VibmV0czogW1xuICAgICAgICB7IHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfSxcbiAgICAgICAgeyBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIER5bmFtb0RCIFRhYmxlc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIFVzZXJzIFRhYmxlXG4gICAgdGhpcy51c2Vyc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdVc2Vyc1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgY29kZWZsb3ctdXNlcnMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAndXNlcl9pZCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR1NJIGZvciBsZWV0Y29kZV91c2VybmFtZSBsb29rdXBcbiAgICB0aGlzLnVzZXJzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnbGVldGNvZGUtdXNlcm5hbWUtaW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdsZWV0Y29kZV91c2VybmFtZScsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLnVzZXJzVGFibGUpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy11c2Vycy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLnVzZXJzVGFibGUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gTGVhcm5pbmdQYXRocyBUYWJsZVxuICAgIHRoaXMubGVhcm5pbmdQYXRoc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdMZWFybmluZ1BhdGhzVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBjb2RlZmxvdy1sZWFybmluZy1wYXRocy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdwYXRoX2lkJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBzdHJlYW06IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIHVzZXJfaWQgbG9va3VwXG4gICAgdGhpcy5sZWFybmluZ1BhdGhzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAndXNlci1pZC1pbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ3VzZXJfaWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5sZWFybmluZ1BhdGhzVGFibGUpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1sZWFybmluZy1wYXRocy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBQcm9ncmVzcyBUYWJsZVxuICAgIHRoaXMucHJvZ3Jlc3NUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnUHJvZ3Jlc3NUYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogYGNvZGVmbG93LXByb2dyZXNzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ3Byb2dyZXNzX2lkJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsIC8vIHVzZXJfaWQjZGF0ZSBmb3JtYXRcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3IgdXNlcl9pZCBsb29rdXBcbiAgICB0aGlzLnByb2dyZXNzVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAndXNlci1pZC1pbmRleCcsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ3VzZXJfaWQnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBwcm9qZWN0aW9uVHlwZTogZHluYW1vZGIuUHJvamVjdGlvblR5cGUuQUxMLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5wcm9ncmVzc1RhYmxlKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctcHJvZ3Jlc3MtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5wcm9ncmVzc1RhYmxlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIExMTUNhY2hlIFRhYmxlIHdpdGggVFRMXG4gICAgdGhpcy5sbG1DYWNoZVRhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdMTE1DYWNoZVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgY29kZWZsb3ctbGxtLWNhY2hlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ3F1ZXJ5X2hhc2gnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgZW5jcnlwdGlvbjogZHluYW1vZGIuVGFibGVFbmNyeXB0aW9uLkFXU19NQU5BR0VELFxuICAgICAgcG9pbnRJblRpbWVSZWNvdmVyeTogdHJ1ZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIENhY2hlIGNhbiBiZSByZWNyZWF0ZWRcbiAgICAgIHN0cmVhbTogZHluYW1vZGIuU3RyZWFtVmlld1R5cGUuTkVXX0FORF9PTERfSU1BR0VTLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsIC8vIFRUTDogNyBkYXlzXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmxsbUNhY2hlVGFibGUpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1sbG0tY2FjaGUtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5sbG1DYWNoZVRhYmxlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIENvbnZlcnNhdGlvbkhpc3RvcnkgVGFibGUgd2l0aCBUVExcbiAgICB0aGlzLmNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnQ29udmVyc2F0aW9uSGlzdG9yeVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgY29kZWZsb3ctY29udmVyc2F0aW9uLWhpc3RvcnktJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAndXNlcl9pZCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxuICAgICAgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJywgLy8gVFRMOiA5MCBkYXlzXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWNvbnZlcnNhdGlvbi1oaXN0b3J5LSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuY29udmVyc2F0aW9uSGlzdG9yeVRhYmxlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIEtub3dsZWRnZUJhc2UgVGFibGVcbiAgICB0aGlzLmtub3dsZWRnZUJhc2VUYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnS25vd2xlZGdlQmFzZVRhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgY29kZWZsb3cta25vd2xlZGdlLWJhc2UtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAnZG9jX2lkJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIGVuY3J5cHRpb246IGR5bmFtb2RiLlRhYmxlRW5jcnlwdGlvbi5BV1NfTUFOQUdFRCxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWUsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBzdHJlYW06IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIGNhdGVnb3J5LWluZGV4XG4gICAgdGhpcy5rbm93bGVkZ2VCYXNlVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnY2F0ZWdvcnktaW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdjYXRlZ29yeScsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogJ3N1YmNhdGVnb3J5JyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgcHJvamVjdGlvblR5cGU6IGR5bmFtb2RiLlByb2plY3Rpb25UeXBlLkFMTCxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBHU0kgZm9yIGNvbXBsZXhpdHktaW5kZXhcbiAgICB0aGlzLmtub3dsZWRnZUJhc2VUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XG4gICAgICBpbmRleE5hbWU6ICdjb21wbGV4aXR5LWluZGV4JyxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAnY29tcGxleGl0eScsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogJ2xhc3RfdXBkYXRlZCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHByb2plY3Rpb25UeXBlOiBkeW5hbW9kYi5Qcm9qZWN0aW9uVHlwZS5BTEwsXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmtub3dsZWRnZUJhc2VUYWJsZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWtub3dsZWRnZS1iYXNlLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMua25vd2xlZGdlQmFzZVRhYmxlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIEFuYWx5dGljcyBUYWJsZVxuICAgIHRoaXMuYW5hbHl0aWNzVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0FuYWx5dGljc1RhYmxlJywge1xuICAgICAgdGFibGVOYW1lOiBgY29kZWZsb3ctYW5hbHl0aWNzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ2RhdGUnLFxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcbiAgICAgIH0sXG4gICAgICBzb3J0S2V5OiB7XG4gICAgICAgIG5hbWU6ICdtZXRyaWNfdHlwZScsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgc3RyZWFtOiBkeW5hbW9kYi5TdHJlYW1WaWV3VHlwZS5ORVdfQU5EX09MRF9JTUFHRVMsXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmFuYWx5dGljc1RhYmxlKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctYW5hbHl0aWNzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuYW5hbHl0aWNzVGFibGUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gSW50ZXJ2aWV3U2Vzc2lvbnMgVGFibGUgLSBTdG9yZXMgQUkgaW50ZXJ2aWV3IHNpbXVsYXRvciBzZXNzaW9uIGRhdGFcbiAgICB0aGlzLmludGVydmlld1Nlc3Npb25zVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0ludGVydmlld1Nlc3Npb25zVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6IGBjb2RlZmxvdy1pbnRlcnZpZXctc2Vzc2lvbnMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHBhcnRpdGlvbktleToge1xuICAgICAgICBuYW1lOiAnc2Vzc2lvbl9pZCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxuICAgICAgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICBlbmNyeXB0aW9uOiBkeW5hbW9kYi5UYWJsZUVuY3J5cHRpb24uQVdTX01BTkFHRUQsXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgR1NJIGZvciBxdWVyeWluZyBieSB1c2VyX2lkXG4gICAgdGhpcy5pbnRlcnZpZXdTZXNzaW9uc1RhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcbiAgICAgIGluZGV4TmFtZTogJ3VzZXItaWQtaW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICd1c2VyX2lkJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXG4gICAgICB9LFxuICAgICAgc29ydEtleToge1xuICAgICAgICBuYW1lOiAndGltZXN0YW1wJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEdTSSBmb3IgcXVlcnlpbmcgYnkgaW50ZXJ2aWV3X3R5cGVcbiAgICB0aGlzLmludGVydmlld1Nlc3Npb25zVGFibGUuYWRkR2xvYmFsU2Vjb25kYXJ5SW5kZXgoe1xuICAgICAgaW5kZXhOYW1lOiAnaW50ZXJ2aWV3LXR5cGUtaW5kZXgnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdpbnRlcnZpZXdfdHlwZScsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxuICAgICAgfSxcbiAgICAgIHNvcnRLZXk6IHtcbiAgICAgICAgbmFtZTogJ3RpbWVzdGFtcCcsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuaW50ZXJ2aWV3U2Vzc2lvbnNUYWJsZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWludGVydmlldy1zZXNzaW9ucy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmludGVydmlld1Nlc3Npb25zVGFibGUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFMzIEJ1Y2tldHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBTdGF0aWMgQXNzZXRzIEJ1Y2tldCAoUmVhY3QgYnVpbGQgYXJ0aWZhY3RzLCBpbWFnZXMsIGZvbnRzLCBpY29ucylcbiAgICB0aGlzLnN0YXRpY0Fzc2V0c0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ1N0YXRpY0Fzc2V0c0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBjb2RlZmxvdy1zdGF0aWMtYXNzZXRzLSR7ZW52aXJvbm1lbnROYW1lfS0ke3RoaXMuYWNjb3VudH1gLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHZlcnNpb25lZDogZmFsc2UsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogZmFsc2UsXG4gICAgICBcbiAgICAgIC8vIExpZmVjeWNsZSBwb2xpY2llczogVHJhbnNpdGlvbiB0byBJQSBhZnRlciA5MCBkYXlzXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdUcmFuc2l0aW9uVG9JQScsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgXG4gICAgICAvLyBDT1JTIGNvbmZpZ3VyYXRpb24gZm9yIFJlYWN0IGZyb250ZW5kXG4gICAgICBjb3JzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogW1xuICAgICAgICAgICAgczMuSHR0cE1ldGhvZHMuR0VULFxuICAgICAgICAgICAgczMuSHR0cE1ldGhvZHMuSEVBRCxcbiAgICAgICAgICBdLFxuICAgICAgICAgIGFsbG93ZWRPcmlnaW5zOiBbJyonXSwgLy8gV2lsbCBiZSByZXN0cmljdGVkIHRvIHNwZWNpZmljIGRvbWFpbiBpbiBwcm9kdWN0aW9uXG4gICAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxuICAgICAgICAgIG1heEFnZTogMzAwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLnN0YXRpY0Fzc2V0c0J1Y2tldCkuYWRkKCdOYW1lJywgYGNvZGVmbG93LXN0YXRpYy1hc3NldHMtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5zdGF0aWNBc3NldHNCdWNrZXQpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gS25vd2xlZGdlIEJhc2UgRG9jdW1lbnRzIEJ1Y2tldCAoQWxnb3JpdGhtIGV4cGxhbmF0aW9ucywgcGF0dGVybnMsIGRlYnVnZ2luZyBndWlkZXMpXG4gICAgdGhpcy5rYkRvY3VtZW50c0J1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0tCRG9jdW1lbnRzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGNvZGVmbG93LWtiLWRvY3VtZW50cy0ke2Vudmlyb25tZW50TmFtZX0tJHt0aGlzLmFjY291bnR9YCxcbiAgICAgIGVuY3J5cHRpb246IHMzLkJ1Y2tldEVuY3J5cHRpb24uUzNfTUFOQUdFRCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICB2ZXJzaW9uZWQ6IHRydWUsIC8vIEVuYWJsZSB2ZXJzaW9uaW5nIGZvciBrbm93bGVkZ2UgYmFzZSBkb2N1bWVudHNcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBmYWxzZSxcbiAgICAgIFxuICAgICAgLy8gTGlmZWN5Y2xlIHBvbGljaWVzOiBUcmFuc2l0aW9uIHRvIElBIGFmdGVyIDkwIGRheXNcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ1RyYW5zaXRpb25Ub0lBJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklORlJFUVVFTlRfQUNDRVNTLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDkwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQ2xlYW51cE9sZFZlcnNpb25zJyxcbiAgICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uVHJhbnNpdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc3RvcmFnZUNsYXNzOiBzMy5TdG9yYWdlQ2xhc3MuSU5GUkVRVUVOVF9BQ0NFU1MsXG4gICAgICAgICAgICAgIHRyYW5zaXRpb25BZnRlcjogY2RrLkR1cmF0aW9uLmRheXMoMzApLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICAgIG5vbmN1cnJlbnRWZXJzaW9uRXhwaXJhdGlvbjogY2RrLkR1cmF0aW9uLmRheXMoOTApLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIFxuICAgICAgLy8gQ09SUyBjb25maWd1cmF0aW9uIGZvciBCZWRyb2NrIEtub3dsZWRnZSBCYXNlIGFjY2Vzc1xuICAgICAgY29yczogW1xuICAgICAgICB7XG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IFtcbiAgICAgICAgICAgIHMzLkh0dHBNZXRob2RzLkdFVCxcbiAgICAgICAgICAgIHMzLkh0dHBNZXRob2RzLlBVVCxcbiAgICAgICAgICAgIHMzLkh0dHBNZXRob2RzLlBPU1QsXG4gICAgICAgICAgXSxcbiAgICAgICAgICBhbGxvd2VkT3JpZ2luczogWycqJ10sIC8vIEJlZHJvY2sgc2VydmljZSB3aWxsIGFjY2VzcyB0aGlzXG4gICAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxuICAgICAgICAgIG1heEFnZTogMzAwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmtiRG9jdW1lbnRzQnVja2V0KS5hZGQoJ05hbWUnLCBgY29kZWZsb3cta2ItZG9jdW1lbnRzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMua2JEb2N1bWVudHNCdWNrZXQpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gRGF0YXNldHMgQnVja2V0IChMZWV0Q29kZSBwcm9ibGVtIGFyY2hpdmVzLCB1c2VyIHN1Ym1pc3Npb24gZXhwb3J0cywgYW5hbHl0aWNzIHNuYXBzaG90cylcbiAgICB0aGlzLmRhdGFzZXRzQnVja2V0ID0gbmV3IHMzLkJ1Y2tldCh0aGlzLCAnRGF0YXNldHNCdWNrZXQnLCB7XG4gICAgICBidWNrZXROYW1lOiBgY29kZWZsb3ctZGF0YXNldHMtJHtlbnZpcm9ubWVudE5hbWV9LSR7dGhpcy5hY2NvdW50fWAsXG4gICAgICBlbmNyeXB0aW9uOiBzMy5CdWNrZXRFbmNyeXB0aW9uLlMzX01BTkFHRUQsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgdmVyc2lvbmVkOiBmYWxzZSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICAgIGF1dG9EZWxldGVPYmplY3RzOiBmYWxzZSxcbiAgICAgIFxuICAgICAgLy8gTGlmZWN5Y2xlIHBvbGljaWVzOiBJQSBhZnRlciA5MCBkYXlzLCBHbGFjaWVyIGFmdGVyIDE4MCBkYXlzXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdUcmFuc2l0aW9uVG9JQScsXG4gICAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgICB0cmFuc2l0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5JTkZSRVFVRU5UX0FDQ0VTUyxcbiAgICAgICAgICAgICAgdHJhbnNpdGlvbkFmdGVyOiBjZGsuRHVyYXRpb24uZGF5cyg5MCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzdG9yYWdlQ2xhc3M6IHMzLlN0b3JhZ2VDbGFzcy5HTEFDSUVSLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDE4MCksXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5kYXRhc2V0c0J1Y2tldCkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWRhdGFzZXRzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuZGF0YXNldHNCdWNrZXQpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFtYXpvbiBPcGVuU2VhcmNoIERvbWFpbiAoVmVjdG9yIFNlYXJjaClcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgSUFNIHJvbGUgZm9yIE9wZW5TZWFyY2ggZG9tYWluXG4gICAgY29uc3Qgb3BlblNlYXJjaFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ09wZW5TZWFyY2hSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGBjb2RlZmxvdy1vcGVuc2VhcmNoLXJvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdvcGVuc2VhcmNoc2VydmljZS5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBPcGVuU2VhcmNoIGRvbWFpbicsXG4gICAgfSk7XG5cbiAgICAvLyBPcGVuU2VhcmNoIERvbWFpbiBmb3IgdmVjdG9yIHNlYXJjaCB3aXRoIGstTk5cbiAgICB0aGlzLm9wZW5TZWFyY2hEb21haW4gPSBuZXcgb3BlbnNlYXJjaC5Eb21haW4odGhpcywgJ09wZW5TZWFyY2hEb21haW4nLCB7XG4gICAgICBkb21haW5OYW1lOiBgY29kZWZsb3ctb3BlbnNlYXJjaC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgdmVyc2lvbjogb3BlbnNlYXJjaC5FbmdpbmVWZXJzaW9uLk9QRU5TRUFSQ0hfMl8xMSxcbiAgICAgIFxuICAgICAgLy8gQ2FwYWNpdHkgY29uZmlndXJhdGlvbjogcjZnLmxhcmdlLnNlYXJjaCwgMiBub2Rlc1xuICAgICAgY2FwYWNpdHk6IHtcbiAgICAgICAgZGF0YU5vZGVJbnN0YW5jZVR5cGU6ICdyNmcubGFyZ2Uuc2VhcmNoJyxcbiAgICAgICAgZGF0YU5vZGVzOiAyLFxuICAgICAgICBtdWx0aUF6V2l0aFN0YW5kYnlFbmFibGVkOiBmYWxzZSwgLy8gQ29zdCBvcHRpbWl6YXRpb24gZm9yIGRldi9zdGFnaW5nXG4gICAgICB9LFxuICAgICAgXG4gICAgICAvLyBFQlMgc3RvcmFnZTogMTAwR0IgcGVyIG5vZGVcbiAgICAgIGViczoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICB2b2x1bWVTaXplOiAxMDAsXG4gICAgICAgIHZvbHVtZVR5cGU6IGVjMi5FYnNEZXZpY2VWb2x1bWVUeXBlLkdQMyxcbiAgICAgICAgaW9wczogMzAwMCxcbiAgICAgICAgdGhyb3VnaHB1dDogMTI1LFxuICAgICAgfSxcbiAgICAgIFxuICAgICAgLy8gVlBDIGNvbmZpZ3VyYXRpb24gZm9yIHNlY3VyZSBhY2Nlc3NcbiAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICB2cGNTdWJuZXRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgICAgIGF2YWlsYWJpbGl0eVpvbmVzOiB0aGlzLnZwYy5hdmFpbGFiaWxpdHlab25lcy5zbGljZSgwLCAyKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMub3BlblNlYXJjaFNlY3VyaXR5R3JvdXBdLFxuICAgICAgXG4gICAgICAvLyBFbmNyeXB0aW9uIGNvbmZpZ3VyYXRpb25cbiAgICAgIGVuY3J5cHRpb25BdFJlc3Q6IHtcbiAgICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBub2RlVG9Ob2RlRW5jcnlwdGlvbjogdHJ1ZSxcbiAgICAgIGVuZm9yY2VIdHRwczogdHJ1ZSxcbiAgICAgIFxuICAgICAgLy8gRmluZS1ncmFpbmVkIGFjY2VzcyBjb250cm9sXG4gICAgICBmaW5lR3JhaW5lZEFjY2Vzc0NvbnRyb2w6IHtcbiAgICAgICAgbWFzdGVyVXNlckFybjogb3BlblNlYXJjaFJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgICBcbiAgICAgIC8vIExvZ2dpbmcgY29uZmlndXJhdGlvblxuICAgICAgbG9nZ2luZzoge1xuICAgICAgICBzbG93U2VhcmNoTG9nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgYXBwTG9nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc2xvd0luZGV4TG9nRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgc2xvd1NlYXJjaExvZ0dyb3VwOiBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnT3BlblNlYXJjaFNsb3dTZWFyY2hMb2dzJywge1xuICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3Mvb3BlbnNlYXJjaC9jb2RlZmxvdy0ke2Vudmlyb25tZW50TmFtZX0vc2xvdy1zZWFyY2hgLFxuICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pLFxuICAgICAgICBhcHBMb2dHcm91cDogbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ09wZW5TZWFyY2hBcHBMb2dzJywge1xuICAgICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3Mvb3BlbnNlYXJjaC9jb2RlZmxvdy0ke2Vudmlyb25tZW50TmFtZX0vYXBwYCxcbiAgICAgICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgICB9KSxcbiAgICAgICAgc2xvd0luZGV4TG9nR3JvdXA6IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdPcGVuU2VhcmNoU2xvd0luZGV4TG9ncycsIHtcbiAgICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL29wZW5zZWFyY2gvY29kZWZsb3ctJHtlbnZpcm9ubWVudE5hbWV9L3Nsb3ctaW5kZXhgLFxuICAgICAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICAgIFxuICAgICAgLy8gQWR2YW5jZWQgb3B0aW9ucyBmb3Igay1OTiBwbHVnaW5cbiAgICAgIGFkdmFuY2VkT3B0aW9uczoge1xuICAgICAgICAncmVzdC5hY3Rpb24ubXVsdGkuYWxsb3dfZXhwbGljaXRfaW5kZXgnOiAndHJ1ZScsXG4gICAgICAgICdpbmRpY2VzLnF1ZXJ5LmJvb2wubWF4X2NsYXVzZV9jb3VudCc6ICcxMDI0JyxcbiAgICAgIH0sXG4gICAgICBcbiAgICAgIC8vIEF1dG9tYXRlZCBzbmFwc2hvdHNcbiAgICAgIGF1dG9tYXRlZFNuYXBzaG90U3RhcnRIb3VyOiAyLCAvLyAyIEFNIFVUQ1xuICAgICAgXG4gICAgICAvLyBSZW1vdmFsIHBvbGljeVxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLFxuICAgICAgXG4gICAgICAvLyBFbmFibGUgY3VzdG9tIGVuZHBvaW50IChvcHRpb25hbClcbiAgICAgIGN1c3RvbUVuZHBvaW50OiB1bmRlZmluZWQsXG4gICAgICBcbiAgICAgIC8vIFpvbmUgYXdhcmVuZXNzIGZvciBoaWdoIGF2YWlsYWJpbGl0eVxuICAgICAgem9uZUF3YXJlbmVzczoge1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBhdmFpbGFiaWxpdHlab25lQ291bnQ6IDIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgTGFtYmRhIGFjY2VzcyB0byBPcGVuU2VhcmNoXG4gICAgdGhpcy5vcGVuU2VhcmNoRG9tYWluLmdyYW50UmVhZFdyaXRlKG9wZW5TZWFyY2hSb2xlKTtcblxuICAgIC8vIE5vdGU6IEFjY2VzcyBjb250cm9sIGZvciBWUEMtYmFzZWQgT3BlblNlYXJjaCBpcyBtYW5hZ2VkIHRocm91Z2ggc2VjdXJpdHkgZ3JvdXBzXG4gICAgLy8gSVAtYmFzZWQgYWNjZXNzIHBvbGljaWVzIGFyZSBub3QgY29tcGF0aWJsZSB3aXRoIFZQQyBlbmRwb2ludHNcblxuICAgIGNkay5UYWdzLm9mKHRoaXMub3BlblNlYXJjaERvbWFpbikuYWRkKCdOYW1lJywgYGNvZGVmbG93LW9wZW5zZWFyY2gtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5vcGVuU2VhcmNoRG9tYWluKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBbWF6b24gQmVkcm9jayBLbm93bGVkZ2UgQmFzZSBDb25maWd1cmF0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBCZWRyb2NrIEtub3dsZWRnZSBCYXNlXG4gICAgdGhpcy5iZWRyb2NrS25vd2xlZGdlQmFzZVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0JlZHJvY2tLbm93bGVkZ2VCYXNlUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgY29kZWZsb3ctYmVkcm9jay1rYi1yb2xlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnYmVkcm9jay5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBCZWRyb2NrIEtub3dsZWRnZSBCYXNlIHRvIGFjY2VzcyBTMyBhbmQgT3BlblNlYXJjaCcsXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBTMyByZWFkIHBlcm1pc3Npb25zIHRvIEJlZHJvY2sgS25vd2xlZGdlIEJhc2VcbiAgICB0aGlzLmtiRG9jdW1lbnRzQnVja2V0LmdyYW50UmVhZCh0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlUm9sZSk7XG5cbiAgICAvLyBHcmFudCBPcGVuU2VhcmNoIHBlcm1pc3Npb25zIHRvIEJlZHJvY2sgS25vd2xlZGdlIEJhc2VcbiAgICB0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdhb3NzOkFQSUFjY2Vzc0FsbCcsIC8vIE9wZW5TZWFyY2ggU2VydmVybGVzcyAoaWYgdXNpbmcgc2VydmVybGVzcylcbiAgICAgICAgJ2VzOkVTSHR0cEdldCcsXG4gICAgICAgICdlczpFU0h0dHBQb3N0JyxcbiAgICAgICAgJ2VzOkVTSHR0cFB1dCcsXG4gICAgICAgICdlczpFU0h0dHBEZWxldGUnLFxuICAgICAgICAnZXM6RVNIdHRwSGVhZCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIHRoaXMub3BlblNlYXJjaERvbWFpbi5kb21haW5Bcm4sXG4gICAgICAgIGAke3RoaXMub3BlblNlYXJjaERvbWFpbi5kb21haW5Bcm59LypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBCZWRyb2NrIG1vZGVsIGludm9jYXRpb24gcGVybWlzc2lvbnNcbiAgICB0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC9hbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MWAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2VSb2xlKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctYmVkcm9jay1rYi1yb2xlLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2VSb2xlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIE5vdGU6IEJlZHJvY2sgS25vd2xlZGdlIEJhc2UgY3JlYXRpb24gaXMgbm90IGRpcmVjdGx5IHN1cHBvcnRlZCBieSBDREsgTDIgY29uc3RydWN0cyB5ZXQuXG4gICAgLy8gV2UgbmVlZCB0byB1c2UgTDEgKENsb3VkRm9ybWF0aW9uKSBjb25zdHJ1Y3RzIG9yIGNyZWF0ZSBpdCBtYW51YWxseS92aWEgQVdTIENMSS5cbiAgICAvLyBUaGUgZm9sbG93aW5nIGlzIGEgQ2xvdWRGb3JtYXRpb24tYmFzZWQgYXBwcm9hY2ggdXNpbmcgTDEgY29uc3RydWN0cy5cblxuICAgIC8vIENyZWF0ZSBCZWRyb2NrIEtub3dsZWRnZSBCYXNlIHVzaW5nIEwxIGNvbnN0cnVjdFxuICAgIC8vIFRPRE86IFRlbXBvcmFyaWx5IGRpc2FibGVkIC0gcmVxdWlyZXMgT3BlblNlYXJjaCBTZXJ2ZXJsZXNzIGNvbGxlY3Rpb24gc2V0dXBcbiAgICAvLyBXaWxsIGJlIGFkZGVkIGluIGEgZm9sbG93LXVwIGRlcGxveW1lbnRcbiAgICAvKlxuICAgIHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2UgPSBuZXcgY2RrLmF3c19iZWRyb2NrLkNmbktub3dsZWRnZUJhc2UodGhpcywgJ0JlZHJvY2tLbm93bGVkZ2VCYXNlJywge1xuICAgICAgbmFtZTogYGtiLWNvZGVmbG93LWFsZ29yaXRobXMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS25vd2xlZGdlIEJhc2UgZm9yIENvZGVGbG93IEFJIFBsYXRmb3JtIGNvbnRhaW5pbmcgYWxnb3JpdGhtIGV4cGxhbmF0aW9ucywgcGF0dGVybnMsIGFuZCBkZWJ1Z2dpbmcgZ3VpZGVzJyxcbiAgICAgIHJvbGVBcm46IHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2VSb2xlLnJvbGVBcm4sXG4gICAgICBrbm93bGVkZ2VCYXNlQ29uZmlndXJhdGlvbjoge1xuICAgICAgICB0eXBlOiAnVkVDVE9SJyxcbiAgICAgICAgdmVjdG9yS25vd2xlZGdlQmFzZUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBlbWJlZGRpbmdNb2RlbEFybjogYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC9hbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MWAsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgc3RvcmFnZUNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgdHlwZTogJ09QRU5TRUFSQ0hfU0VSVkVSTEVTUycsXG4gICAgICAgIG9wZW5zZWFyY2hTZXJ2ZXJsZXNzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGNvbGxlY3Rpb25Bcm46IGBhcm46YXdzOmFvc3M6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmNvbGxlY3Rpb24vY29kZWZsb3cta2ItJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgICAgICB2ZWN0b3JJbmRleE5hbWU6ICdjb2RlZmxvdy1rYi1pbmRleCcsXG4gICAgICAgICAgZmllbGRNYXBwaW5nOiB7XG4gICAgICAgICAgICB2ZWN0b3JGaWVsZDogJ2VtYmVkZGluZycsXG4gICAgICAgICAgICB0ZXh0RmllbGQ6ICd0ZXh0JyxcbiAgICAgICAgICAgIG1ldGFkYXRhRmllbGQ6ICdtZXRhZGF0YScsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgZGVwZW5kZW5jeSB0byBlbnN1cmUgcm9sZSBpcyBjcmVhdGVkIGJlZm9yZSBLbm93bGVkZ2UgQmFzZVxuICAgIC8vIHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2Uubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2VSb2xlKTtcbiAgICAvLyB0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLm9wZW5TZWFyY2hEb21haW4pO1xuICAgIC8vIHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2Uubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMua2JEb2N1bWVudHNCdWNrZXQpO1xuXG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcy5iZWRyb2NrS25vd2xlZGdlQmFzZSkuYWRkKCdOYW1lJywgYGtiLWNvZGVmbG93LWFsZ29yaXRobXMtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcy5iZWRyb2NrS25vd2xlZGdlQmFzZSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBDcmVhdGUgQmVkcm9jayBLbm93bGVkZ2UgQmFzZSBEYXRhIFNvdXJjZSAoUzMpXG4gICAgLy8gVE9ETzogVGVtcG9yYXJpbHkgZGlzYWJsZWQgLSBkZXBlbmRzIG9uIEtub3dsZWRnZSBCYXNlXG4gICAgLypcbiAgICB0aGlzLmJlZHJvY2tEYXRhU291cmNlID0gbmV3IGNkay5hd3NfYmVkcm9jay5DZm5EYXRhU291cmNlKHRoaXMsICdCZWRyb2NrRGF0YVNvdXJjZScsIHtcbiAgICAgIG5hbWU6IGBjb2RlZmxvdy1rYi1zMy1kYXRhc291cmNlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIGRhdGEgc291cmNlIGZvciBDb2RlRmxvdyBLbm93bGVkZ2UgQmFzZScsXG4gICAgICBrbm93bGVkZ2VCYXNlSWQ6IHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2UuYXR0cktub3dsZWRnZUJhc2VJZCxcbiAgICAgIGRhdGFTb3VyY2VDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIHR5cGU6ICdTMycsXG4gICAgICAgIHMzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIGJ1Y2tldEFybjogdGhpcy5rYkRvY3VtZW50c0J1Y2tldC5idWNrZXRBcm4sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgdmVjdG9ySW5nZXN0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBjaHVua2luZ0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICBjaHVua2luZ1N0cmF0ZWd5OiAnRklYRURfU0laRScsXG4gICAgICAgICAgZml4ZWRTaXplQ2h1bmtpbmdDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBtYXhUb2tlbnM6IDUwMCxcbiAgICAgICAgICAgIG92ZXJsYXBQZXJjZW50YWdlOiAxMCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBkZXBlbmRlbmN5IHRvIGVuc3VyZSBLbm93bGVkZ2UgQmFzZSBpcyBjcmVhdGVkIGJlZm9yZSBEYXRhIFNvdXJjZVxuICAgIHRoaXMuYmVkcm9ja0RhdGFTb3VyY2Uubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2UpO1xuXG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcy5iZWRyb2NrRGF0YVNvdXJjZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWtiLXMzLWRhdGFzb3VyY2UtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgLy8gY2RrLlRhZ3Mub2YodGhpcy5iZWRyb2NrRGF0YVNvdXJjZSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBDcmVhdGUgRXZlbnRCcmlkZ2UgcnVsZSBmb3IgZGFpbHkgS25vd2xlZGdlIEJhc2Ugc3luYyAoMiBBTSBVVEMpXG4gICAgLy8gVE9ETzogVGVtcG9yYXJpbHkgZGlzYWJsZWQgLSBkZXBlbmRzIG9uIEtub3dsZWRnZSBCYXNlXG4gICAgLypcbiAgICBjb25zdCBrYlN5bmNSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdLbm93bGVkZ2VCYXNlU3luY1J1bGUnLCB7XG4gICAgICBydWxlTmFtZTogYGNvZGVmbG93LWtiLXN5bmMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGFpbHkgc3luYyBvZiBCZWRyb2NrIEtub3dsZWRnZSBCYXNlIGF0IDIgQU0gVVRDJyxcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XG4gICAgICAgIG1pbnV0ZTogJzAnLFxuICAgICAgICBob3VyOiAnMicsXG4gICAgICAgIGRheTogJyonLFxuICAgICAgICBtb250aDogJyonLFxuICAgICAgICB5ZWFyOiAnKicsXG4gICAgICB9KSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG4gICAgKi9cblxuICAgIC8vIFRPRE86IFRlbXBvcmFyaWx5IGRpc2FibGVkIC0gZGVwZW5kcyBvbiBLbm93bGVkZ2UgQmFzZVxuICAgIC8qXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBmdW5jdGlvbiB0byB0cmlnZ2VyIEtub3dsZWRnZSBCYXNlIHN5bmNcbiAgICBjb25zdCBrYlN5bmNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0tCU3luY0Z1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgY29kZWZsb3cta2Itc3luYy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTEsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tSW5saW5lKGBcbmltcG9ydCBqc29uXG5pbXBvcnQgYm90bzNcbmltcG9ydCBvc1xuXG5iZWRyb2NrX2FnZW50ID0gYm90bzMuY2xpZW50KCdiZWRyb2NrLWFnZW50JylcblxuZGVmIGhhbmRsZXIoZXZlbnQsIGNvbnRleHQpOlxuICAgIFwiXCJcIlxuICAgIFRyaWdnZXIgQmVkcm9jayBLbm93bGVkZ2UgQmFzZSBkYXRhIHNvdXJjZSBzeW5jLlxuICAgIFRoaXMgZnVuY3Rpb24gaXMgaW52b2tlZCBkYWlseSBhdCAyIEFNIFVUQyBieSBFdmVudEJyaWRnZS5cbiAgICBcIlwiXCJcbiAgICBrbm93bGVkZ2VfYmFzZV9pZCA9IG9zLmVudmlyb25bJ0tOT1dMRURHRV9CQVNFX0lEJ11cbiAgICBkYXRhX3NvdXJjZV9pZCA9IG9zLmVudmlyb25bJ0RBVEFfU09VUkNFX0lEJ11cbiAgICBcbiAgICB0cnk6XG4gICAgICAgICMgU3RhcnQgaW5nZXN0aW9uIGpvYlxuICAgICAgICByZXNwb25zZSA9IGJlZHJvY2tfYWdlbnQuc3RhcnRfaW5nZXN0aW9uX2pvYihcbiAgICAgICAgICAgIGtub3dsZWRnZUJhc2VJZD1rbm93bGVkZ2VfYmFzZV9pZCxcbiAgICAgICAgICAgIGRhdGFTb3VyY2VJZD1kYXRhX3NvdXJjZV9pZCxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uPWYnRGFpbHkgc3luYyB0cmlnZ2VyZWQgYXQge2V2ZW50W1widGltZVwiXX0nXG4gICAgICAgIClcbiAgICAgICAgXG4gICAgICAgIHByaW50KGZcIlN0YXJ0ZWQgaW5nZXN0aW9uIGpvYjoge3Jlc3BvbnNlWydpbmdlc3Rpb25Kb2InXVsnaW5nZXN0aW9uSm9iSWQnXX1cIilcbiAgICAgICAgXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAnc3RhdHVzQ29kZSc6IDIwMCxcbiAgICAgICAgICAgICdib2R5JzoganNvbi5kdW1wcyh7XG4gICAgICAgICAgICAgICAgJ21lc3NhZ2UnOiAnS25vd2xlZGdlIEJhc2Ugc3luYyBzdGFydGVkIHN1Y2Nlc3NmdWxseScsXG4gICAgICAgICAgICAgICAgJ2luZ2VzdGlvbkpvYklkJzogcmVzcG9uc2VbJ2luZ2VzdGlvbkpvYiddWydpbmdlc3Rpb25Kb2JJZCddLFxuICAgICAgICAgICAgICAgICdzdGF0dXMnOiByZXNwb25zZVsnaW5nZXN0aW9uSm9iJ11bJ3N0YXR1cyddXG4gICAgICAgICAgICB9KVxuICAgICAgICB9XG4gICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlOlxuICAgICAgICBwcmludChmXCJFcnJvciBzdGFydGluZyBpbmdlc3Rpb24gam9iOiB7c3RyKGUpfVwiKVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgJ3N0YXR1c0NvZGUnOiA1MDAsXG4gICAgICAgICAgICAnYm9keSc6IGpzb24uZHVtcHMoe1xuICAgICAgICAgICAgICAgICdtZXNzYWdlJzogJ0ZhaWxlZCB0byBzdGFydCBLbm93bGVkZ2UgQmFzZSBzeW5jJyxcbiAgICAgICAgICAgICAgICAnZXJyb3InOiBzdHIoZSlcbiAgICAgICAgICAgIH0pXG4gICAgICAgIH1cbmApLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgS05PV0xFREdFX0JBU0VfSUQ6IHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2UuYXR0cktub3dsZWRnZUJhc2VJZCxcbiAgICAgICAgREFUQV9TT1VSQ0VfSUQ6IHRoaXMuYmVkcm9ja0RhdGFTb3VyY2UuYXR0ckRhdGFTb3VyY2VJZCxcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50TmFtZSxcbiAgICAgIH0sXG4gICAgICBkZXNjcmlwdGlvbjogJ1RyaWdnZXIgZGFpbHkgc3luYyBvZiBCZWRyb2NrIEtub3dsZWRnZSBCYXNlJyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIHRvIHN0YXJ0IGluZ2VzdGlvbiBqb2JcbiAgICBrYlN5bmNGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jazpTdGFydEluZ2VzdGlvbkpvYicsXG4gICAgICAgICdiZWRyb2NrOkdldEluZ2VzdGlvbkpvYicsXG4gICAgICAgICdiZWRyb2NrOkxpc3RJbmdlc3Rpb25Kb2JzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06a25vd2xlZGdlLWJhc2UvJHt0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlLmF0dHJLbm93bGVkZ2VCYXNlSWR9YCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06a25vd2xlZGdlLWJhc2UvJHt0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlLmF0dHJLbm93bGVkZ2VCYXNlSWR9L2RhdGEtc291cmNlLyR7dGhpcy5iZWRyb2NrRGF0YVNvdXJjZS5hdHRyRGF0YVNvdXJjZUlkfWAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIEFkZCBMYW1iZGEgZnVuY3Rpb24gYXMgdGFyZ2V0IGZvciBFdmVudEJyaWRnZSBydWxlXG4gICAga2JTeW5jUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24oa2JTeW5jRnVuY3Rpb24sIHtcbiAgICAgIHJldHJ5QXR0ZW1wdHM6IDIsXG4gICAgICBtYXhFdmVudEFnZTogY2RrLkR1cmF0aW9uLmhvdXJzKDIpLFxuICAgIH0pKTtcblxuICAgIGNkay5UYWdzLm9mKGtiU3luY0Z1bmN0aW9uKS5hZGQoJ05hbWUnLCBgY29kZWZsb3cta2Itc3luYy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZihrYlN5bmNGdW5jdGlvbikuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG4gICAgY2RrLlRhZ3Mub2Yoa2JTeW5jUnVsZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWtiLXN5bmMtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2Yoa2JTeW5jUnVsZSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG4gICAgKi9cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBMYW1iZGEgQXV0aG9yaXplciBmb3IgSldUIFZhbGlkYXRpb25cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIGZ1bmN0aW9uIGZvciBKV1QgdmFsaWRhdGlvblxuICAgIGNvbnN0IGp3dEF1dGhvcml6ZXJGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0pXVEF1dGhvcml6ZXJGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNvZGVmbG93LWp3dC1hdXRob3JpemVyLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vbGFtYmRhLWZ1bmN0aW9ucy9qd3QtYXV0aG9yaXplcicpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50TmFtZSxcbiAgICAgICAgSldUX1NFQ1JFVDogJ1BMQUNFSE9MREVSX0pXVF9TRUNSRVQnLCAvLyBTYW1lIGFzIGF1dGggTGFtYmRhXG4gICAgICB9LFxuICAgICAgZGVzY3JpcHRpb246ICdKV1QgdG9rZW4gdmFsaWRhdGlvbiBmb3IgQVBJIEdhdGV3YXknLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2Yoand0QXV0aG9yaXplckZ1bmN0aW9uKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctand0LWF1dGhvcml6ZXItJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2Yoand0QXV0aG9yaXplckZ1bmN0aW9uKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBUEkgR2F0ZXdheSBSRVNUIEFQSVxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBDbG91ZFdhdGNoIGxvZyBncm91cCBmb3IgQVBJIEdhdGV3YXkgYWNjZXNzIGxvZ3NcbiAgICBjb25zdCBhcGlMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdBUElHYXRld2F5QWNjZXNzTG9ncycsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvYXBpZ2F0ZXdheS9jb2RlZmxvdy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFJFU1QgQVBJIEdhdGV3YXlcbiAgICB0aGlzLnJlc3RBcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdDb2RlRmxvd1Jlc3RBUEknLCB7XG4gICAgICByZXN0QXBpTmFtZTogYGNvZGVmbG93LWFwaS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2RlRmxvdyBBSSBQbGF0Zm9ybSBSRVNUIEFQSScsXG4gICAgICBcbiAgICAgIC8vIERlcGxveSBvcHRpb25zXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogZW52aXJvbm1lbnROYW1lLFxuICAgICAgICBcbiAgICAgICAgLy8gRW5hYmxlIGFjY2VzcyBsb2dnaW5nXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKGFwaUxvZ0dyb3VwKSxcbiAgICAgICAgYWNjZXNzTG9nRm9ybWF0OiBhcGlnYXRld2F5LkFjY2Vzc0xvZ0Zvcm1hdC5qc29uV2l0aFN0YW5kYXJkRmllbGRzKHtcbiAgICAgICAgICBjYWxsZXI6IHRydWUsXG4gICAgICAgICAgaHR0cE1ldGhvZDogdHJ1ZSxcbiAgICAgICAgICBpcDogdHJ1ZSxcbiAgICAgICAgICBwcm90b2NvbDogdHJ1ZSxcbiAgICAgICAgICByZXF1ZXN0VGltZTogdHJ1ZSxcbiAgICAgICAgICByZXNvdXJjZVBhdGg6IHRydWUsXG4gICAgICAgICAgcmVzcG9uc2VMZW5ndGg6IHRydWUsXG4gICAgICAgICAgc3RhdHVzOiB0cnVlLFxuICAgICAgICAgIHVzZXI6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgICBcbiAgICAgICAgLy8gRW5hYmxlIENsb3VkV2F0Y2ggbWV0cmljc1xuICAgICAgICBtZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgICBcbiAgICAgICAgLy8gVGhyb3R0bGluZyBzZXR0aW5ncyAoZ2xvYmFsIGRlZmF1bHRzKVxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAwLCAvLyByZXF1ZXN0cyBwZXIgc2Vjb25kXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiAyMDAwLCAvLyBidXJzdCBjYXBhY2l0eVxuICAgICAgICBcbiAgICAgICAgLy8gRW5hYmxlIFgtUmF5IHRyYWNpbmdcbiAgICAgICAgdHJhY2luZ0VuYWJsZWQ6IHRydWUsXG4gICAgICB9LFxuICAgICAgXG4gICAgICAvLyBDT1JTIGNvbmZpZ3VyYXRpb24gZm9yIFJlYWN0IGZyb250ZW5kXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBbXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6NTE3MycsIC8vIFZpdGUgZGV2IHNlcnZlclxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjMwMDAnLCAvLyBBbHRlcm5hdGl2ZSBkZXYgcG9ydFxuICAgICAgICAgICdodHRwczovL2NvZGVmbG93LmFpJywgLy8gUHJvZHVjdGlvbiBkb21haW4gKHBsYWNlaG9sZGVyKVxuICAgICAgICBdLFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ1BPU1QnLCAnUFVUJywgJ0RFTEVURScsICdPUFRJT05TJ10sXG4gICAgICAgIGFsbG93SGVhZGVyczogW1xuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcbiAgICAgICAgICAnWC1SZXF1ZXN0LUlEJyxcbiAgICAgICAgICAnWC1BbXotRGF0ZScsXG4gICAgICAgICAgJ1gtQXBpLUtleScsXG4gICAgICAgICAgJ1gtQW16LVNlY3VyaXR5LVRva2VuJyxcbiAgICAgICAgXSxcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgICAgbWF4QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICB9LFxuICAgICAgXG4gICAgICAvLyBFbmFibGUgQVBJIGtleSByZXF1aXJlbWVudCBmb3IgYWRtaW4gZW5kcG9pbnRzXG4gICAgICBhcGlLZXlTb3VyY2VUeXBlOiBhcGlnYXRld2F5LkFwaUtleVNvdXJjZVR5cGUuSEVBREVSLFxuICAgICAgXG4gICAgICAvLyBDbG91ZCBmb3JtYXRpb24gcmVtb3ZhbCBwb2xpY3lcbiAgICAgIGNsb3VkV2F0Y2hSb2xlOiB0cnVlLFxuICAgICAgXG4gICAgICAvLyBFbmRwb2ludCBjb25maWd1cmF0aW9uXG4gICAgICBlbmRwb2ludENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgdHlwZXM6IFthcGlnYXRld2F5LkVuZHBvaW50VHlwZS5SRUdJT05BTF0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5yZXN0QXBpKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctYXBpLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMucmVzdEFwaSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBBZGQgR2F0ZXdheSBSZXNwb25zZXMgZm9yIENPUlMgb24gZXJyb3IgcmVzcG9uc2VzXG4gICAgdGhpcy5yZXN0QXBpLmFkZEdhdGV3YXlSZXNwb25zZSgnVW5hdXRob3JpemVkNDAzJywge1xuICAgICAgdHlwZTogYXBpZ2F0ZXdheS5SZXNwb25zZVR5cGUuVU5BVVRIT1JJWkVELFxuICAgICAgc3RhdHVzQ29kZTogJzQwMycsXG4gICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1SZXF1ZXN0LUlEJ1wiLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUydcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlc3RBcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdBY2Nlc3NEZW5pZWQnLCB7XG4gICAgICB0eXBlOiBhcGlnYXRld2F5LlJlc3BvbnNlVHlwZS5BQ0NFU1NfREVOSUVELFxuICAgICAgc3RhdHVzQ29kZTogJzQwMycsXG4gICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1SZXF1ZXN0LUlEJ1wiLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUydcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlc3RBcGkuYWRkR2F0ZXdheVJlc3BvbnNlKCdEZWZhdWx0NFhYJywge1xuICAgICAgdHlwZTogYXBpZ2F0ZXdheS5SZXNwb25zZVR5cGUuREVGQVVMVF80WFgsXG4gICAgICByZXNwb25zZUhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogXCInQ29udGVudC1UeXBlLEF1dGhvcml6YXRpb24sWC1SZXF1ZXN0LUlEJ1wiLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IFwiJ0dFVCxQT1NULFBVVCxERUxFVEUsT1BUSU9OUydcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUmVxdWVzdCBWYWxpZGF0b3JzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIHJlcXVlc3QgdmFsaWRhdG9yIGZvciBib2R5IGFuZCBwYXJhbWV0ZXJzXG4gICAgY29uc3QgcmVxdWVzdFZhbGlkYXRvciA9IG5ldyBhcGlnYXRld2F5LlJlcXVlc3RWYWxpZGF0b3IodGhpcywgJ1JlcXVlc3RWYWxpZGF0b3InLCB7XG4gICAgICByZXN0QXBpOiB0aGlzLnJlc3RBcGksXG4gICAgICByZXF1ZXN0VmFsaWRhdG9yTmFtZTogJ3JlcXVlc3QtYm9keS12YWxpZGF0b3InLFxuICAgICAgdmFsaWRhdGVSZXF1ZXN0Qm9keTogdHJ1ZSxcbiAgICAgIHZhbGlkYXRlUmVxdWVzdFBhcmFtZXRlcnM6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTGFtYmRhIEF1dGhvcml6ZXJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIGF1dGhvcml6ZXIgZm9yIEpXVCB2YWxpZGF0aW9uXG4gICAgLy8gTm90ZTogVGhlIGF1dGhvcml6ZXIgd2lsbCBiZSBhdXRvbWF0aWNhbGx5IGF0dGFjaGVkIHRvIHRoZSBSRVNUIEFQSSB3aGVuIHVzZWQgaW4gbWV0aG9kIGNvbmZpZ3VyYXRpb25zXG4gICAgdGhpcy5qd3RBdXRob3JpemVyID0gbmV3IGFwaWdhdGV3YXkuUmVxdWVzdEF1dGhvcml6ZXIodGhpcywgJ0pXVEF1dGhvcml6ZXInLCB7XG4gICAgICBoYW5kbGVyOiBqd3RBdXRob3JpemVyRnVuY3Rpb24sXG4gICAgICBpZGVudGl0eVNvdXJjZXM6IFthcGlnYXRld2F5LklkZW50aXR5U291cmNlLmhlYWRlcignQXV0aG9yaXphdGlvbicpXSxcbiAgICAgIGF1dGhvcml6ZXJOYW1lOiAnand0LWF1dGhvcml6ZXInLFxuICAgICAgcmVzdWx0c0NhY2hlVHRsOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSwgLy8gQ2FjaGUgYXV0aG9yaXphdGlvbiByZXN1bHRzIGZvciA1IG1pbnV0ZXNcbiAgICB9KTtcbiAgICBcbiAgICAvLyBCaW5kIHRoZSBhdXRob3JpemVyIHRvIHRoZSBSRVNUIEFQSVxuICAgIHRoaXMuand0QXV0aG9yaXplci5fYXR0YWNoVG9BcGkodGhpcy5yZXN0QXBpKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBKU09OIFNjaGVtYSBNb2RlbHMgZm9yIFJlcXVlc3QgVmFsaWRhdGlvblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIFVzZXIgcmVnaXN0cmF0aW9uIHJlcXVlc3QgbW9kZWxcbiAgICBjb25zdCByZWdpc3RlclJlcXVlc3RNb2RlbCA9IHRoaXMucmVzdEFwaS5hZGRNb2RlbCgnUmVnaXN0ZXJSZXF1ZXN0TW9kZWwnLCB7XG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgbW9kZWxOYW1lOiAnUmVnaXN0ZXJSZXF1ZXN0JyxcbiAgICAgIHNjaGVtYToge1xuICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLk9CSkVDVCxcbiAgICAgICAgcmVxdWlyZWQ6IFsndXNlcm5hbWUnLCAncGFzc3dvcmQnLCAnbGVldGNvZGVfdXNlcm5hbWUnXSxcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIHVzZXJuYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgIG1pbkxlbmd0aDogMyxcbiAgICAgICAgICAgIG1heExlbmd0aDogNTAsXG4gICAgICAgICAgICBwYXR0ZXJuOiAnXlthLXpBLVowLTlfLV0rJCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwYXNzd29yZDoge1xuICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgICAgICBtYXhMZW5ndGg6IDEyOCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGxlZXRjb2RlX3VzZXJuYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgIG1pbkxlbmd0aDogMSxcbiAgICAgICAgICAgIG1heExlbmd0aDogNTAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBVc2VyIGxvZ2luIHJlcXVlc3QgbW9kZWxcbiAgICBjb25zdCBsb2dpblJlcXVlc3RNb2RlbCA9IHRoaXMucmVzdEFwaS5hZGRNb2RlbCgnTG9naW5SZXF1ZXN0TW9kZWwnLCB7XG4gICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgbW9kZWxOYW1lOiAnTG9naW5SZXF1ZXN0JyxcbiAgICAgIHNjaGVtYToge1xuICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLk9CSkVDVCxcbiAgICAgICAgcmVxdWlyZWQ6IFsndXNlcm5hbWUnLCAncGFzc3dvcmQnXSxcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIHVzZXJuYW1lOiB7XG4gICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgIG1pbkxlbmd0aDogMyxcbiAgICAgICAgICAgIG1heExlbmd0aDogNTAsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwYXNzd29yZDoge1xuICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgICAgICBtYXhMZW5ndGg6IDEyOCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENoYXQgbWVzc2FnZSByZXF1ZXN0IG1vZGVsXG4gICAgY29uc3QgY2hhdE1lc3NhZ2VSZXF1ZXN0TW9kZWwgPSB0aGlzLnJlc3RBcGkuYWRkTW9kZWwoJ0NoYXRNZXNzYWdlUmVxdWVzdE1vZGVsJywge1xuICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIG1vZGVsTmFtZTogJ0NoYXRNZXNzYWdlUmVxdWVzdCcsXG4gICAgICBzY2hlbWE6IHtcbiAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5PQkpFQ1QsXG4gICAgICAgIHJlcXVpcmVkOiBbJ21lc3NhZ2UnXSxcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIG1lc3NhZ2U6IHtcbiAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuU1RSSU5HLFxuICAgICAgICAgICAgbWluTGVuZ3RoOiAxLFxuICAgICAgICAgICAgbWF4TGVuZ3RoOiA1MDAwLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgY29kZToge1xuICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICBtYXhMZW5ndGg6IDEwMDAwLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJvYmxlbV9pZDoge1xuICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkcsXG4gICAgICAgICAgICBtYXhMZW5ndGg6IDEwMCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBVc2FnZSBQbGFucyBhbmQgQVBJIEtleXNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBDcmVhdGUgdXNhZ2UgcGxhbiBmb3IgYXV0aGVudGljYXRlZCB1c2VycyAoMTAwIHJlcS9taW4gcGVyIHVzZXIpXG4gICAgY29uc3QgdXNlclVzYWdlUGxhbiA9IHRoaXMucmVzdEFwaS5hZGRVc2FnZVBsYW4oJ1VzZXJVc2FnZVBsYW4nLCB7XG4gICAgICBuYW1lOiBgY29kZWZsb3ctdXNlci1wbGFuLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VzYWdlIHBsYW4gZm9yIGF1dGhlbnRpY2F0ZWQgdXNlcnMnLFxuICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgcmF0ZUxpbWl0OiAxMDAsIC8vIDEwMCByZXF1ZXN0cyBwZXIgbWludXRlIHBlciB1c2VyXG4gICAgICAgIGJ1cnN0TGltaXQ6IDIwMCwgLy8gQWxsb3cgYnVyc3Qgb2YgMjAwIHJlcXVlc3RzXG4gICAgICB9LFxuICAgICAgcXVvdGE6IHtcbiAgICAgICAgbGltaXQ6IDEwMDAwLCAvLyAxMCwwMDAgcmVxdWVzdHMgcGVyIG1vbnRoIHBlciB1c2VyXG4gICAgICAgIHBlcmlvZDogYXBpZ2F0ZXdheS5QZXJpb2QuTU9OVEgsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQXNzb2NpYXRlIHVzYWdlIHBsYW4gd2l0aCBBUEkgc3RhZ2VcbiAgICB1c2VyVXNhZ2VQbGFuLmFkZEFwaVN0YWdlKHtcbiAgICAgIHN0YWdlOiB0aGlzLnJlc3RBcGkuZGVwbG95bWVudFN0YWdlLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIHVzYWdlIHBsYW4gZm9yIGFub255bW91cy9JUC1iYXNlZCByYXRlIGxpbWl0aW5nICgxMCByZXEvbWluIHBlciBJUClcbiAgICBjb25zdCBhbm9ueW1vdXNVc2FnZVBsYW4gPSB0aGlzLnJlc3RBcGkuYWRkVXNhZ2VQbGFuKCdBbm9ueW1vdXNVc2FnZVBsYW4nLCB7XG4gICAgICBuYW1lOiBgY29kZWZsb3ctYW5vbnltb3VzLXBsYW4tJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVXNhZ2UgcGxhbiBmb3IgYW5vbnltb3VzIHVzZXJzIChJUC1iYXNlZCByYXRlIGxpbWl0aW5nKScsXG4gICAgICB0aHJvdHRsZToge1xuICAgICAgICByYXRlTGltaXQ6IDEwLCAvLyAxMCByZXF1ZXN0cyBwZXIgbWludXRlIHBlciBJUFxuICAgICAgICBidXJzdExpbWl0OiAyMCwgLy8gQWxsb3cgYnVyc3Qgb2YgMjAgcmVxdWVzdHNcbiAgICAgIH0sXG4gICAgICBxdW90YToge1xuICAgICAgICBsaW1pdDogMTAwMCwgLy8gMSwwMDAgcmVxdWVzdHMgcGVyIG1vbnRoIHBlciBJUFxuICAgICAgICBwZXJpb2Q6IGFwaWdhdGV3YXkuUGVyaW9kLk1PTlRILFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFzc29jaWF0ZSBhbm9ueW1vdXMgdXNhZ2UgcGxhbiB3aXRoIEFQSSBzdGFnZVxuICAgIGFub255bW91c1VzYWdlUGxhbi5hZGRBcGlTdGFnZSh7XG4gICAgICBzdGFnZTogdGhpcy5yZXN0QXBpLmRlcGxveW1lbnRTdGFnZSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBBUEkga2V5IGZvciBhZG1pbiBlbmRwb2ludHNcbiAgICBjb25zdCBhZG1pbkFwaUtleSA9IHRoaXMucmVzdEFwaS5hZGRBcGlLZXkoJ0FkbWluQXBpS2V5Jywge1xuICAgICAgYXBpS2V5TmFtZTogYGNvZGVmbG93LWFkbWluLWtleS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkga2V5IGZvciBhZG1pbiBlbmRwb2ludHMnLFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIHVzYWdlIHBsYW4gZm9yIGFkbWluIChoaWdoZXIgbGltaXRzKVxuICAgIGNvbnN0IGFkbWluVXNhZ2VQbGFuID0gdGhpcy5yZXN0QXBpLmFkZFVzYWdlUGxhbignQWRtaW5Vc2FnZVBsYW4nLCB7XG4gICAgICBuYW1lOiBgY29kZWZsb3ctYWRtaW4tcGxhbi0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdVc2FnZSBwbGFuIGZvciBhZG1pbiBlbmRwb2ludHMnLFxuICAgICAgdGhyb3R0bGU6IHtcbiAgICAgICAgcmF0ZUxpbWl0OiA1MDAsIC8vIDUwMCByZXF1ZXN0cyBwZXIgbWludXRlXG4gICAgICAgIGJ1cnN0TGltaXQ6IDEwMDAsIC8vIEFsbG93IGJ1cnN0IG9mIDEwMDAgcmVxdWVzdHNcbiAgICAgIH0sXG4gICAgICBxdW90YToge1xuICAgICAgICBsaW1pdDogMTAwMDAwLCAvLyAxMDAsMDAwIHJlcXVlc3RzIHBlciBtb250aFxuICAgICAgICBwZXJpb2Q6IGFwaWdhdGV3YXkuUGVyaW9kLk1PTlRILFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEFzc29jaWF0ZSBhZG1pbiBBUEkga2V5IHdpdGggdXNhZ2UgcGxhblxuICAgIGFkbWluVXNhZ2VQbGFuLmFkZEFwaUtleShhZG1pbkFwaUtleSk7XG5cbiAgICAvLyBBc3NvY2lhdGUgYWRtaW4gdXNhZ2UgcGxhbiB3aXRoIEFQSSBzdGFnZVxuICAgIGFkbWluVXNhZ2VQbGFuLmFkZEFwaVN0YWdlKHtcbiAgICAgIHN0YWdlOiB0aGlzLnJlc3RBcGkuZGVwbG95bWVudFN0YWdlLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFQSSBHYXRld2F5IFJlc291cmNlIFN0cnVjdHVyZSAoUGxhY2Vob2xkZXIpXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIFxuICAgIC8vIENyZWF0ZSAvYXV0aCByZXNvdXJjZVxuICAgIGNvbnN0IGF1dGhSZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdhdXRoJyk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIC9hbmFseXplIHJlc291cmNlXG4gICAgY29uc3QgYW5hbHl6ZVJlc291cmNlID0gdGhpcy5yZXN0QXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FuYWx5emUnKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgL2NoYXQgcmVzb3VyY2VcbiAgICBjb25zdCBjaGF0UmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgnY2hhdCcpO1xuICAgIFxuICAgIC8vIENyZWF0ZSAvcmVjb21tZW5kYXRpb25zIHJlc291cmNlXG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgncmVjb21tZW5kYXRpb25zJyk7XG4gICAgXG4gICAgLy8gQ3JlYXRlIC9wcm9ncmVzcyByZXNvdXJjZVxuICAgIGNvbnN0IHByb2dyZXNzUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgncHJvZ3Jlc3MnKTtcbiAgICBcbiAgICAvLyBDcmVhdGUgL2FkbWluIHJlc291cmNlXG4gICAgY29uc3QgYWRtaW5SZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdhZG1pbicpO1xuXG4gICAgLy8gQ3JlYXRlIC9pbnRlcnZpZXcgcmVzb3VyY2VcbiAgICBjb25zdCBpbnRlcnZpZXdSZXNvdXJjZSA9IHRoaXMucmVzdEFwaS5yb290LmFkZFJlc291cmNlKCdpbnRlcnZpZXcnKTtcblxuICAgIC8vIE5vdGU6IEFjdHVhbCBMYW1iZGEgaW50ZWdyYXRpb25zIHdpbGwgYmUgYWRkZWQgaW4gdGFzayAxLjYgd2hlbiBMYW1iZGEgZnVuY3Rpb25zIGFyZSBjcmVhdGVkXG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gTGFtYmRhIExheWVyIGZvciBTaGFyZWQgRGVwZW5kZW5jaWVzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIExhbWJkYSBsYXllciBmb3Igc2hhcmVkIGRlcGVuZGVuY2llcyAoYm90bzMsIHB5ZGFudGljLCBodHRweClcbiAgICB0aGlzLnNoYXJlZERlcGVuZGVuY2llc0xheWVyID0gbmV3IGxhbWJkYS5MYXllclZlcnNpb24odGhpcywgJ1NoYXJlZERlcGVuZGVuY2llc0xheWVyJywge1xuICAgICAgbGF5ZXJWZXJzaW9uTmFtZTogYGNvZGVmbG93LXNoYXJlZC1kZXBlbmRlbmNpZXMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vbGFtYmRhLWxheWVycy9zaGFyZWQtZGVwZW5kZW5jaWVzJyksXG4gICAgICBjb21wYXRpYmxlUnVudGltZXM6IFtsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMV0sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NoYXJlZCBkZXBlbmRlbmNpZXM6IGJvdG8zLCBweWRhbnRpYywgaHR0cHgsIGFuZCBjb21tb24gdXRpbGl0aWVzJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTixcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuc2hhcmVkRGVwZW5kZW5jaWVzTGF5ZXIpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1zaGFyZWQtZGVwZW5kZW5jaWVzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuc2hhcmVkRGVwZW5kZW5jaWVzTGF5ZXIpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFNRUyBRdWV1ZXMgZm9yIEJhY2tncm91bmQgSm9ic1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIERlYWQgTGV0dGVyIFF1ZXVlIGZvciBmYWlsZWQgZXZlbnRzXG4gICAgdGhpcy5kZWFkTGV0dGVyUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdEZWFkTGV0dGVyUXVldWUnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBjb2RlZmxvdy1kbHEtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGVuY3J5cHRpb246IHNxcy5RdWV1ZUVuY3J5cHRpb24uU1FTX01BTkFHRUQsXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKDE0KSwgLy8gS2VlcCBmYWlsZWQgbWVzc2FnZXMgZm9yIDE0IGRheXNcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmRlYWRMZXR0ZXJRdWV1ZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWRscS0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmRlYWRMZXR0ZXJRdWV1ZSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBCYWNrZ3JvdW5kIEpvYnMgUXVldWUgKFN0YW5kYXJkIFF1ZXVlKVxuICAgIHRoaXMuYmFja2dyb3VuZEpvYnNRdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0JhY2tncm91bmRKb2JzUXVldWUnLCB7XG4gICAgICBxdWV1ZU5hbWU6IGBjb2RlZmxvdy1iYWNrZ3JvdW5kLWpvYnMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGVuY3J5cHRpb246IHNxcy5RdWV1ZUVuY3J5cHRpb24uU1FTX01BTkFHRUQsXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLCAvLyAxNSBtaW51dGVzIGZvciBoZWF2eSBwcm9jZXNzaW5nXG4gICAgICByZWNlaXZlTWVzc2FnZVdhaXRUaW1lOiBjZGsuRHVyYXRpb24uc2Vjb25kcygyMCksIC8vIExvbmcgcG9sbGluZ1xuICAgICAgcmV0ZW50aW9uUGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cyg0KSwgLy8gS2VlcCBtZXNzYWdlcyBmb3IgNCBkYXlzXG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHtcbiAgICAgICAgcXVldWU6IHRoaXMuZGVhZExldHRlclF1ZXVlLFxuICAgICAgICBtYXhSZWNlaXZlQ291bnQ6IDMsIC8vIE1vdmUgdG8gRExRIGFmdGVyIDMgZmFpbGVkIGF0dGVtcHRzXG4gICAgICB9LFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuYmFja2dyb3VuZEpvYnNRdWV1ZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWJhY2tncm91bmQtam9icy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmJhY2tncm91bmRKb2JzUXVldWUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEV2ZW50QnJpZGdlIEV2ZW50IEJ1c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBjdXN0b20gZXZlbnQgYnVzIGZvciBDb2RlRmxvdyBldmVudHNcbiAgICB0aGlzLmV2ZW50QnVzID0gbmV3IGV2ZW50cy5FdmVudEJ1cyh0aGlzLCAnQ29kZUZsb3dFdmVudEJ1cycsIHtcbiAgICAgIGV2ZW50QnVzTmFtZTogYGNvZGVmbG93LWV2ZW50cy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5ldmVudEJ1cykuYWRkKCdOYW1lJywgYGNvZGVmbG93LWV2ZW50cy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmV2ZW50QnVzKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBMYW1iZGEgRnVuY3Rpb25zXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ29tbW9uIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgYWxsIExhbWJkYSBmdW5jdGlvbnNcbiAgICBjb25zdCBjb21tb25FbnZpcm9ubWVudCA9IHtcbiAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudE5hbWUsXG4gICAgICBVU0VSU19UQUJMRTogdGhpcy51c2Vyc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIExFQVJOSU5HX1BBVEhTX1RBQkxFOiB0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICBQUk9HUkVTU19UQUJMRTogdGhpcy5wcm9ncmVzc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIExMTV9DQUNIRV9UQUJMRTogdGhpcy5sbG1DYWNoZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIENPTlZFUlNBVElPTl9ISVNUT1JZX1RBQkxFOiB0aGlzLmNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZS50YWJsZU5hbWUsXG4gICAgICBLTk9XTEVER0VfQkFTRV9UQUJMRTogdGhpcy5rbm93bGVkZ2VCYXNlVGFibGUudGFibGVOYW1lLFxuICAgICAgQU5BTFlUSUNTX1RBQkxFOiB0aGlzLmFuYWx5dGljc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIE9QRU5TRUFSQ0hfRU5EUE9JTlQ6IHRoaXMub3BlblNlYXJjaERvbWFpbi5kb21haW5FbmRwb2ludCxcbiAgICAgIEtCX0RPQ1VNRU5UU19CVUNLRVQ6IHRoaXMua2JEb2N1bWVudHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIERBVEFTRVRTX0JVQ0tFVDogdGhpcy5kYXRhc2V0c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgUkVHSU9OOiB0aGlzLnJlZ2lvbiwgIC8vIENoYW5nZWQgZnJvbSBBV1NfUkVHSU9OIHRvIFJFR0lPTiAoQVdTX1JFR0lPTiBpcyByZXNlcnZlZClcbiAgICAgIEVWRU5UX0JVU19OQU1FOiB0aGlzLmV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgIEJBQ0tHUk9VTkRfSk9CU19RVUVVRV9VUkw6IHRoaXMuYmFja2dyb3VuZEpvYnNRdWV1ZS5xdWV1ZVVybCxcbiAgICB9O1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIDEuIEF1dGggTGFtYmRhIEZ1bmN0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBBdXRoIExhbWJkYVxuICAgIGNvbnN0IGF1dGhMYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdBdXRoTGFtYmRhUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgY29kZWZsb3ctYXV0aC1sYW1iZGEtcm9sZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBBdXRoIExhbWJkYSBmdW5jdGlvbicsXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBEeW5hbW9EQiBwZXJtaXNzaW9ucyAoVXNlcnMgdGFibGUgb25seSlcbiAgICB0aGlzLnVzZXJzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGF1dGhMYW1iZGFSb2xlKTtcblxuICAgIC8vIEdyYW50IFgtUmF5IHBlcm1pc3Npb25zXG4gICAgYXV0aExhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDcmVhdGUgQXV0aCBMYW1iZGEgZnVuY3Rpb25cbiAgICB0aGlzLmF1dGhGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0F1dGhGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNvZGVmbG93LWF1dGgtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9sYW1iZGEtZnVuY3Rpb25zL2F1dGgnKSxcbiAgICAgIHJvbGU6IGF1dGhMYW1iZGFSb2xlLFxuICAgICAgbGF5ZXJzOiBbdGhpcy5zaGFyZWREZXBlbmRlbmNpZXNMYXllcl0sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAuLi5jb21tb25FbnZpcm9ubWVudCxcbiAgICAgICAgSldUX1NFQ1JFVDogJ1BMQUNFSE9MREVSX0pXVF9TRUNSRVQnLCAvLyBUT0RPOiBVc2UgU2VjcmV0cyBNYW5hZ2VyIGluIHByb2R1Y3Rpb25cbiAgICAgIH0sXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1dGhlbnRpY2F0aW9uIHNlcnZpY2U6IHVzZXIgcmVnaXN0cmF0aW9uLCBsb2dpbiwgSldUIHRva2VuIGdlbmVyYXRpb24nLFxuICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLCAvLyBFbmFibGUgWC1SYXkgdHJhY2luZ1xuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMubGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuYXV0aEZ1bmN0aW9uKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctYXV0aC0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmF1dGhGdW5jdGlvbikuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gMi4gQW5hbHlzaXMgTGFtYmRhIEZ1bmN0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBBbmFseXNpcyBMYW1iZGFcbiAgICBjb25zdCBhbmFseXNpc0xhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0FuYWx5c2lzTGFtYmRhUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgY29kZWZsb3ctYW5hbHlzaXMtbGFtYmRhLXJvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgQW5hbHlzaXMgTGFtYmRhIGZ1bmN0aW9uJyxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXG4gICAgdGhpcy51c2Vyc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhbmFseXNpc0xhbWJkYVJvbGUpO1xuICAgIHRoaXMucHJvZ3Jlc3NUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYW5hbHlzaXNMYW1iZGFSb2xlKTtcbiAgICB0aGlzLmFuYWx5dGljc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhbmFseXNpc0xhbWJkYVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgRXZlbnRCcmlkZ2UgcGVybWlzc2lvbnNcbiAgICBhbmFseXNpc0xhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnZXZlbnRzOlB1dEV2ZW50cycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbYGFybjphd3M6ZXZlbnRzOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTpldmVudC1idXMvY29kZWZsb3ctZXZlbnRzLSR7ZW52aXJvbm1lbnROYW1lfWBdLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFgtUmF5IHBlcm1pc3Npb25zXG4gICAgYW5hbHlzaXNMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ3hyYXk6UHV0VHJhY2VTZWdtZW50cycsXG4gICAgICAgICd4cmF5OlB1dFRlbGVtZXRyeVJlY29yZHMnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gQ3JlYXRlIEFuYWx5c2lzIExhbWJkYSBmdW5jdGlvblxuICAgIHRoaXMuYW5hbHlzaXNGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0FuYWx5c2lzRnVuY3Rpb24nLCB7XG4gICAgICBmdW5jdGlvbk5hbWU6IGBjb2RlZmxvdy1hbmFseXNpcy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTEsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2xhbWJkYS1mdW5jdGlvbnMvYW5hbHlzaXMnKSxcbiAgICAgIHJvbGU6IGFuYWx5c2lzTGFtYmRhUm9sZSxcbiAgICAgIGxheWVyczogW3RoaXMuc2hhcmVkRGVwZW5kZW5jaWVzTGF5ZXJdLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMTAyNCxcbiAgICAgIGVudmlyb25tZW50OiBjb21tb25FbnZpcm9ubWVudCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHJvZmlsZSBhbmFseXNpcyBzZXJ2aWNlOiBwYXJzZSBzdWJtaXNzaW9ucywgY2xhc3NpZnkgdG9waWNzLCBjYWxjdWxhdGUgcHJvZmljaWVuY3knLFxuICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMubGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuYW5hbHlzaXNGdW5jdGlvbikuYWRkKCdOYW1lJywgYGNvZGVmbG93LWFuYWx5c2lzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuYW5hbHlzaXNGdW5jdGlvbikuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gMy4gUmVjb21tZW5kYXRpb25zIExhbWJkYSBGdW5jdGlvblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgUmVjb21tZW5kYXRpb25zIExhbWJkYVxuICAgIGNvbnN0IHJlY29tbWVuZGF0aW9uc0xhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JlY29tbWVuZGF0aW9uc0xhbWJkYVJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYGNvZGVmbG93LXJlY29tbWVuZGF0aW9ucy1sYW1iZGEtcm9sZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBSZWNvbW1lbmRhdGlvbnMgTGFtYmRhIGZ1bmN0aW9uJyxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXG4gICAgdGhpcy51c2Vyc1RhYmxlLmdyYW50UmVhZERhdGEocmVjb21tZW5kYXRpb25zTGFtYmRhUm9sZSk7XG4gICAgdGhpcy5sZWFybmluZ1BhdGhzVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKHJlY29tbWVuZGF0aW9uc0xhbWJkYVJvbGUpO1xuICAgIHRoaXMucHJvZ3Jlc3NUYWJsZS5ncmFudFJlYWREYXRhKHJlY29tbWVuZGF0aW9uc0xhbWJkYVJvbGUpO1xuICAgIHRoaXMubGxtQ2FjaGVUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEocmVjb21tZW5kYXRpb25zTGFtYmRhUm9sZSk7XG5cbiAgICAvLyBHcmFudCBCZWRyb2NrIHBlcm1pc3Npb25zIChpbmNsdWRpbmcgTm92YSBpbmZlcmVuY2UgcHJvZmlsZXMpXG4gICAgcmVjb21tZW5kYXRpb25zTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9OmluZmVyZW5jZS1wcm9maWxlLypgLFxuICAgICAgXSxcbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBBV1MgTWFya2V0cGxhY2UgcGVybWlzc2lvbnMgZm9yIEJlZHJvY2sgbW9kZWwgYWNjZXNzXG4gICAgcmVjb21tZW5kYXRpb25zTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdhd3MtbWFya2V0cGxhY2U6Vmlld1N1YnNjcmlwdGlvbnMnLFxuICAgICAgICAnYXdzLW1hcmtldHBsYWNlOlN1YnNjcmliZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBYLVJheSBwZXJtaXNzaW9uc1xuICAgIHJlY29tbWVuZGF0aW9uc0xhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDcmVhdGUgUmVjb21tZW5kYXRpb25zIExhbWJkYSBmdW5jdGlvblxuICAgIHRoaXMucmVjb21tZW5kYXRpb25zRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdSZWNvbW1lbmRhdGlvbnNGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNvZGVmbG93LXJlY29tbWVuZGF0aW9ucy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuUFlUSE9OXzNfMTEsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJy4uL2xhbWJkYS1mdW5jdGlvbnMvcmVjb21tZW5kYXRpb25zJyksXG4gICAgICByb2xlOiByZWNvbW1lbmRhdGlvbnNMYW1iZGFSb2xlLFxuICAgICAgbGF5ZXJzOiBbdGhpcy5zaGFyZWREZXBlbmRlbmNpZXNMYXllcl0sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgZW52aXJvbm1lbnQ6IGNvbW1vbkVudmlyb25tZW50LFxuICAgICAgZGVzY3JpcHRpb246ICdSZWNvbW1lbmRhdGlvbiBlbmdpbmU6IEdvbGRpbG9ja3MgYWxnb3JpdGhtLCBsZWFybmluZyBwYXRoIGdlbmVyYXRpb24sIGFkYXB0aXZlIGRpZmZpY3VsdHknLFxuICAgICAgdHJhY2luZzogbGFtYmRhLlRyYWNpbmcuQUNUSVZFLFxuICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHtcbiAgICAgICAgc3VibmV0VHlwZTogZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9XSVRIX0VHUkVTUyxcbiAgICAgIH0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW3RoaXMubGFtYmRhU2VjdXJpdHlHcm91cF0sXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMucmVjb21tZW5kYXRpb25zRnVuY3Rpb24pLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1yZWNvbW1lbmRhdGlvbnMtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5yZWNvbW1lbmRhdGlvbnNGdW5jdGlvbikuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gNC4gQ2hhdCBNZW50b3IgTGFtYmRhIEZ1bmN0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBDaGF0IE1lbnRvciBMYW1iZGFcbiAgICBjb25zdCBjaGF0TWVudG9yTGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQ2hhdE1lbnRvckxhbWJkYVJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYGNvZGVmbG93LWNoYXQtbWVudG9yLWxhbWJkYS1yb2xlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSUFNIHJvbGUgZm9yIENoYXQgTWVudG9yIExhbWJkYSBmdW5jdGlvbicsXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBEeW5hbW9EQiBwZXJtaXNzaW9uc1xuICAgIHRoaXMudXNlcnNUYWJsZS5ncmFudFJlYWREYXRhKGNoYXRNZW50b3JMYW1iZGFSb2xlKTtcbiAgICB0aGlzLmNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY2hhdE1lbnRvckxhbWJkYVJvbGUpO1xuICAgIHRoaXMubGxtQ2FjaGVUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoY2hhdE1lbnRvckxhbWJkYVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgQmVkcm9jayBwZXJtaXNzaW9ucyAoaW5jbHVkaW5nIEtub3dsZWRnZSBCYXNlIGFuZCBOb3ZhIGluZmVyZW5jZSBwcm9maWxlcylcbiAgICBjaGF0TWVudG9yTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgICAnYmVkcm9jazpSZXRyaWV2ZScsXG4gICAgICAgICdiZWRyb2NrOlJldHJpZXZlQW5kR2VuZXJhdGUnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOio6OmZvdW5kYXRpb24tbW9kZWwvKmAsXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06JHt0aGlzLmFjY291bnR9Omtub3dsZWRnZS1iYXNlLypgLFxuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7dGhpcy5yZWdpb259OiR7dGhpcy5hY2NvdW50fTppbmZlcmVuY2UtcHJvZmlsZS8qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgQVdTIE1hcmtldHBsYWNlIHBlcm1pc3Npb25zIGZvciBCZWRyb2NrIG1vZGVsIGFjY2Vzc1xuICAgIGNoYXRNZW50b3JMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2F3cy1tYXJrZXRwbGFjZTpWaWV3U3Vic2NyaXB0aW9ucycsXG4gICAgICAgICdhd3MtbWFya2V0cGxhY2U6U3Vic2NyaWJlJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IE9wZW5TZWFyY2ggcGVybWlzc2lvbnNcbiAgICBjaGF0TWVudG9yTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdlczpFU0h0dHBHZXQnLFxuICAgICAgICAnZXM6RVNIdHRwUG9zdCcsXG4gICAgICAgICdlczpFU0h0dHBQdXQnLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgJHt0aGlzLm9wZW5TZWFyY2hEb21haW4uZG9tYWluQXJufS8qYCxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgWC1SYXkgcGVybWlzc2lvbnNcbiAgICBjaGF0TWVudG9yTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIENyZWF0ZSBDaGF0IE1lbnRvciBMYW1iZGEgZnVuY3Rpb25cbiAgICB0aGlzLmNoYXRNZW50b3JGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0NoYXRNZW50b3JGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNvZGVmbG93LWNoYXQtbWVudG9yLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vbGFtYmRhLWZ1bmN0aW9ucy9jaGF0LW1lbnRvcicpLFxuICAgICAgcm9sZTogY2hhdE1lbnRvckxhbWJkYVJvbGUsXG4gICAgICBsYXllcnM6IFt0aGlzLnNoYXJlZERlcGVuZGVuY2llc0xheWVyXSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIG1lbW9yeVNpemU6IDIwNDgsXG4gICAgICBlbnZpcm9ubWVudDogY29tbW9uRW52aXJvbm1lbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnNhdGlvbmFsIEFJIG1lbnRvcjogbXVsdGktc3RlcCByZWFzb25pbmcsIFJBRywgY29kZSBhbmFseXNpcywgQmVkcm9jayBpbnRlZ3JhdGlvbicsXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgdnBjU3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5jaGF0TWVudG9yRnVuY3Rpb24pLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1jaGF0LW1lbnRvci0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmNoYXRNZW50b3JGdW5jdGlvbikuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gNS4gU2NyYXBpbmcgTGFtYmRhIEZ1bmN0aW9uXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIElBTSByb2xlIGZvciBTY3JhcGluZyBMYW1iZGFcbiAgICBjb25zdCBzY3JhcGluZ0xhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1NjcmFwaW5nTGFtYmRhUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgY29kZWZsb3ctc2NyYXBpbmctbGFtYmRhLXJvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgU2NyYXBpbmcgTGFtYmRhIGZ1bmN0aW9uJyxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhVlBDQWNjZXNzRXhlY3V0aW9uUm9sZScpLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXG4gICAgdGhpcy51c2Vyc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShzY3JhcGluZ0xhbWJkYVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgUzMgcGVybWlzc2lvbnMgZm9yIGNhY2hpbmcgc2NyYXBlZCBkYXRhXG4gICAgdGhpcy5kYXRhc2V0c0J1Y2tldC5ncmFudFJlYWRXcml0ZShzY3JhcGluZ0xhbWJkYVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgWC1SYXkgcGVybWlzc2lvbnNcbiAgICBzY3JhcGluZ0xhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAneHJheTpQdXRUcmFjZVNlZ21lbnRzJyxcbiAgICAgICAgJ3hyYXk6UHV0VGVsZW1ldHJ5UmVjb3JkcycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICAvLyBDcmVhdGUgU2NyYXBpbmcgTGFtYmRhIGZ1bmN0aW9uXG4gICAgdGhpcy5zY3JhcGluZ0Z1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU2NyYXBpbmdGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNvZGVmbG93LXNjcmFwaW5nLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5QWVRIT05fM18xMSxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnLi4vbGFtYmRhLWZ1bmN0aW9ucy9zY3JhcGluZycpLFxuICAgICAgcm9sZTogc2NyYXBpbmdMYW1iZGFSb2xlLFxuICAgICAgbGF5ZXJzOiBbdGhpcy5zaGFyZWREZXBlbmRlbmNpZXNMYXllcl0sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxuICAgICAgZW52aXJvbm1lbnQ6IGNvbW1vbkVudmlyb25tZW50LFxuICAgICAgZGVzY3JpcHRpb246ICdMZWV0Q29kZSBzY3JhcGluZyBzZXJ2aWNlOiBmZXRjaCB1c2VyIHByb2ZpbGVzLCBzdWJtaXNzaW9ucywgd2l0aCByZXRyeSBsb2dpYyBhbmQgcmF0ZSBsaW1pdGluZycsXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgdnBjU3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5zY3JhcGluZ0Z1bmN0aW9uKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctc2NyYXBpbmctJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5zY3JhcGluZ0Z1bmN0aW9uKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIENyZWF0ZSBJbnRlcnZpZXcgU2ltdWxhdG9yIExhbWJkYSBmdW5jdGlvblxuICAgIGNvbnN0IGludGVydmlld1NpbXVsYXRvckxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0ludGVydmlld1NpbXVsYXRvckxhbWJkYVJvbGUnLCB7XG4gICAgICByb2xlTmFtZTogYGNvZGVmbG93LWludGVydmlldy1zaW11bGF0b3ItbGFtYmRhLXJvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdJQU0gcm9sZSBmb3IgSW50ZXJ2aWV3IFNpbXVsYXRvciBMYW1iZGEgZnVuY3Rpb24nLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnc2VydmljZS1yb2xlL0FXU0xhbWJkYVZQQ0FjY2Vzc0V4ZWN1dGlvblJvbGUnKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBEeW5hbW9EQiBwZXJtaXNzaW9uc1xuICAgIHRoaXMuaW50ZXJ2aWV3U2Vzc2lvbnNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoaW50ZXJ2aWV3U2ltdWxhdG9yTGFtYmRhUm9sZSk7XG4gICAgdGhpcy51c2Vyc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShpbnRlcnZpZXdTaW11bGF0b3JMYW1iZGFSb2xlKTtcbiAgICB0aGlzLmxsbUNhY2hlVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGludGVydmlld1NpbXVsYXRvckxhbWJkYVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgUzMgcGVybWlzc2lvbnMgZm9yIG92ZXJmbG93IHN0b3JhZ2VcbiAgICB0aGlzLmRhdGFzZXRzQnVja2V0LmdyYW50UmVhZFdyaXRlKGludGVydmlld1NpbXVsYXRvckxhbWJkYVJvbGUpO1xuXG4gICAgLy8gR3JhbnQgQmVkcm9jayBwZXJtaXNzaW9ucyAoaW5jbHVkaW5nIE5vdmEgaW5mZXJlbmNlIHByb2ZpbGVzKVxuICAgIGludGVydmlld1NpbXVsYXRvckxhbWJkYVJvbGUuYWRkVG9Qb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbCcsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2s6Kjo6Zm91bmRhdGlvbi1tb2RlbC8qYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06aW5mZXJlbmNlLXByb2ZpbGUvKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IEFXUyBNYXJrZXRwbGFjZSBwZXJtaXNzaW9ucyBmb3IgQmVkcm9jayBtb2RlbCBhY2Nlc3NcbiAgICBpbnRlcnZpZXdTaW11bGF0b3JMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2F3cy1tYXJrZXRwbGFjZTpWaWV3U3Vic2NyaXB0aW9ucycsXG4gICAgICAgICdhd3MtbWFya2V0cGxhY2U6U3Vic2NyaWJlJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IENsb3VkV2F0Y2ggcGVybWlzc2lvbnNcbiAgICBpbnRlcnZpZXdTaW11bGF0b3JMYW1iZGFSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2xvZ3M6Q3JlYXRlTG9nR3JvdXAnLFxuICAgICAgICAnbG9nczpDcmVhdGVMb2dTdHJlYW0nLFxuICAgICAgICAnbG9nczpQdXRMb2dFdmVudHMnLFxuICAgICAgICAnY2xvdWR3YXRjaDpQdXRNZXRyaWNEYXRhJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFgtUmF5IHBlcm1pc3Npb25zXG4gICAgaW50ZXJ2aWV3U2ltdWxhdG9yTGFtYmRhUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIHRoaXMuaW50ZXJ2aWV3U2ltdWxhdG9yRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdJbnRlcnZpZXdTaW11bGF0b3JGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNvZGVmbG93LWludGVydmlldy1zaW11bGF0b3ItJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLlBZVEhPTl8zXzExLFxuICAgICAgaGFuZGxlcjogJ2luZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCcuLi9sYW1iZGEtZnVuY3Rpb25zL2ludGVydmlldy1zaW11bGF0b3InKSxcbiAgICAgIHJvbGU6IGludGVydmlld1NpbXVsYXRvckxhbWJkYVJvbGUsXG4gICAgICBsYXllcnM6IFt0aGlzLnNoYXJlZERlcGVuZGVuY2llc0xheWVyXSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDYwKSxcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIC4uLmNvbW1vbkVudmlyb25tZW50LFxuICAgICAgICBJTlRFUlZJRVdfU0VTU0lPTlNfVEFCTEU6IHRoaXMuaW50ZXJ2aWV3U2Vzc2lvbnNUYWJsZS50YWJsZU5hbWUsXG4gICAgICAgIEJFRFJPQ0tfTU9ERUxfSUQ6ICdhbnRocm9waWMuY2xhdWRlLTMtc29ubmV0LTIwMjQwMjI5LXYxOjAnLFxuICAgICAgICBTM19CVUNLRVQ6IHRoaXMuZGF0YXNldHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIH0sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FJIEludGVydmlldyBTaW11bGF0b3I6IG1vY2sgdGVjaG5pY2FsIGludGVydmlld3Mgd2l0aCBCZWRyb2NrIENsYXVkZSAzIFNvbm5ldCcsXG4gICAgICB0cmFjaW5nOiBsYW1iZGEuVHJhY2luZy5BQ1RJVkUsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgdnBjU3VibmV0czoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwXSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5pbnRlcnZpZXdTaW11bGF0b3JGdW5jdGlvbikuYWRkKCdOYW1lJywgYGNvZGVmbG93LWludGVydmlldy1zaW11bGF0b3ItJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5pbnRlcnZpZXdTaW11bGF0b3JGdW5jdGlvbikuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRXZlbnRCcmlkZ2UgUnVsZXMgYW5kIFRhcmdldHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBSdWxlIDE6IFByb2ZpbGUgQW5hbHlzaXMgQ29tcGxldGUg4oaSIEVDUyBUYXNrIChXZWFrbmVzcyBBbmFseXNpcylcbiAgICBjb25zdCBwcm9maWxlQW5hbHlzaXNDb21wbGV0ZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1Byb2ZpbGVBbmFseXNpc0NvbXBsZXRlUnVsZScsIHtcbiAgICAgIHJ1bGVOYW1lOiBgY29kZWZsb3ctcHJvZmlsZS1hbmFseXNpcy1jb21wbGV0ZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdUcmlnZ2VyIEVDUyB0YXNrIGZvciB3ZWFrbmVzcyBhbmFseXNpcyB3aGVuIHByb2ZpbGUgYW5hbHlzaXMgY29tcGxldGVzJyxcbiAgICAgIGV2ZW50QnVzOiB0aGlzLmV2ZW50QnVzLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydjb2RlZmxvdy5hbmFseXNpcyddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ1Byb2ZpbGVBbmFseXNpc0NvbXBsZXRlJ10sXG4gICAgICB9LFxuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIEFkZCBTUVMgcXVldWUgYXMgdGFyZ2V0IGZvciBQcm9maWxlIEFuYWx5c2lzIENvbXBsZXRlXG4gICAgLy8gTm90ZTogRUNTIHRhc2sgdGFyZ2V0IHdpbGwgYmUgYWRkZWQgaW4gdGFzayAxLjggd2hlbiBFQ1MgY2x1c3RlciBpcyBjcmVhdGVkXG4gICAgcHJvZmlsZUFuYWx5c2lzQ29tcGxldGVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5TcXNRdWV1ZSh0aGlzLmJhY2tncm91bmRKb2JzUXVldWUsIHtcbiAgICAgIG1lc3NhZ2U6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbUV2ZW50UGF0aCgnJC5kZXRhaWwnKSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogdGhpcy5kZWFkTGV0dGVyUXVldWUsXG4gICAgfSkpO1xuXG4gICAgY2RrLlRhZ3Mub2YocHJvZmlsZUFuYWx5c2lzQ29tcGxldGVSdWxlKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctcHJvZmlsZS1hbmFseXNpcy1jb21wbGV0ZS0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZihwcm9maWxlQW5hbHlzaXNDb21wbGV0ZVJ1bGUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gUnVsZSAyOiBMZWFybmluZyBQYXRoIFJlcXVlc3RlZCDihpIgTGFtYmRhIChQYXRoIEdlbmVyYXRvcilcbiAgICBjb25zdCBsZWFybmluZ1BhdGhSZXF1ZXN0ZWRSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdMZWFybmluZ1BhdGhSZXF1ZXN0ZWRSdWxlJywge1xuICAgICAgcnVsZU5hbWU6IGBjb2RlZmxvdy1sZWFybmluZy1wYXRoLXJlcXVlc3RlZC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdUcmlnZ2VyIExhbWJkYSBmdW5jdGlvbiB0byBnZW5lcmF0ZSBsZWFybmluZyBwYXRoJyxcbiAgICAgIGV2ZW50QnVzOiB0aGlzLmV2ZW50QnVzLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIHNvdXJjZTogWydjb2RlZmxvdy5sZWFybmluZyddLFxuICAgICAgICBkZXRhaWxUeXBlOiBbJ0xlYXJuaW5nUGF0aFJlcXVlc3RlZCddLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgTGFtYmRhIChyZWNvbW1lbmRhdGlvbnMpIGFzIHRhcmdldCBmb3IgTGVhcm5pbmcgUGF0aCBSZXF1ZXN0ZWRcbiAgICBsZWFybmluZ1BhdGhSZXF1ZXN0ZWRSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLnJlY29tbWVuZGF0aW9uc0Z1bmN0aW9uLCB7XG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHRoaXMuZGVhZExldHRlclF1ZXVlLFxuICAgICAgbWF4RXZlbnRBZ2U6IGNkay5EdXJhdGlvbi5ob3VycygyKSwgLy8gUmV0cnkgZm9yIHVwIHRvIDIgaG91cnNcbiAgICAgIHJldHJ5QXR0ZW1wdHM6IDIsXG4gICAgfSkpO1xuXG4gICAgY2RrLlRhZ3Mub2YobGVhcm5pbmdQYXRoUmVxdWVzdGVkUnVsZSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LWxlYXJuaW5nLXBhdGgtcmVxdWVzdGVkLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGxlYXJuaW5nUGF0aFJlcXVlc3RlZFJ1bGUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gUnVsZSAzOiBQcm9ibGVtIENvbXBsZXRlZCDihpIgTGFtYmRhIChQcm9ncmVzcyBVcGRhdGUpICsgU1FTIChBbmFseXRpY3MpXG4gICAgY29uc3QgcHJvYmxlbUNvbXBsZXRlZFJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1Byb2JsZW1Db21wbGV0ZWRSdWxlJywge1xuICAgICAgcnVsZU5hbWU6IGBjb2RlZmxvdy1wcm9ibGVtLWNvbXBsZXRlZC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdUcmlnZ2VyIHByb2dyZXNzIHVwZGF0ZSBhbmQgYW5hbHl0aWNzIGFnZ3JlZ2F0aW9uIHdoZW4gcHJvYmxlbSBpcyBjb21wbGV0ZWQnLFxuICAgICAgZXZlbnRCdXM6IHRoaXMuZXZlbnRCdXMsXG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgc291cmNlOiBbJ2NvZGVmbG93LnByb2dyZXNzJ10sXG4gICAgICAgIGRldGFpbFR5cGU6IFsnUHJvYmxlbUNvbXBsZXRlZCddLFxuICAgICAgfSxcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBBZGQgTGFtYmRhIChhbmFseXNpcykgYXMgdGFyZ2V0IGZvciBwcm9ncmVzcyB1cGRhdGVcbiAgICBwcm9ibGVtQ29tcGxldGVkUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24odGhpcy5hbmFseXNpc0Z1bmN0aW9uLCB7XG4gICAgICBkZWFkTGV0dGVyUXVldWU6IHRoaXMuZGVhZExldHRlclF1ZXVlLFxuICAgICAgbWF4RXZlbnRBZ2U6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgIHJldHJ5QXR0ZW1wdHM6IDIsXG4gICAgfSkpO1xuXG4gICAgLy8gQWRkIFNRUyBxdWV1ZSBhcyB0YXJnZXQgZm9yIGFuYWx5dGljcyBhZ2dyZWdhdGlvblxuICAgIHByb2JsZW1Db21wbGV0ZWRSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5TcXNRdWV1ZSh0aGlzLmJhY2tncm91bmRKb2JzUXVldWUsIHtcbiAgICAgIG1lc3NhZ2U6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbUV2ZW50UGF0aCgnJC5kZXRhaWwnKSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogdGhpcy5kZWFkTGV0dGVyUXVldWUsXG4gICAgfSkpO1xuXG4gICAgY2RrLlRhZ3Mub2YocHJvYmxlbUNvbXBsZXRlZFJ1bGUpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1wcm9ibGVtLWNvbXBsZXRlZC0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZihwcm9ibGVtQ29tcGxldGVkUnVsZSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBSdWxlIDQ6IERhaWx5IFN5bmMgU2NoZWR1bGVkIOKGkiBMYW1iZGEgKExlZXRDb2RlIFN5bmMpXG4gICAgY29uc3QgZGFpbHlTeW5jUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnRGFpbHlTeW5jUnVsZScsIHtcbiAgICAgIHJ1bGVOYW1lOiBgY29kZWZsb3ctZGFpbHktc3luYy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdUcmlnZ2VyIGRhaWx5IExlZXRDb2RlIGRhdGEgc3luYyBhdCAyIEFNIFVUQycsXG4gICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLmNyb24oe1xuICAgICAgICBtaW51dGU6ICcwJyxcbiAgICAgICAgaG91cjogJzInLFxuICAgICAgICBkYXk6ICcqJyxcbiAgICAgICAgbW9udGg6ICcqJyxcbiAgICAgICAgeWVhcjogJyonLFxuICAgICAgfSksIC8vIGNyb24oMCAyICogKiA/ICopXG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIExhbWJkYSAoc2NyYXBpbmcpIGFzIHRhcmdldCBmb3IgZGFpbHkgc3luY1xuICAgIGRhaWx5U3luY1J1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHRoaXMuc2NyYXBpbmdGdW5jdGlvbiwge1xuICAgICAgZGVhZExldHRlclF1ZXVlOiB0aGlzLmRlYWRMZXR0ZXJRdWV1ZSxcbiAgICAgIG1heEV2ZW50QWdlOiBjZGsuRHVyYXRpb24uaG91cnMoNiksIC8vIEFsbG93IGxvbmdlciByZXRyeSB3aW5kb3cgZm9yIHNjaGVkdWxlZCBqb2JzXG4gICAgICByZXRyeUF0dGVtcHRzOiAzLFxuICAgIH0pKTtcblxuICAgIGNkay5UYWdzLm9mKGRhaWx5U3luY1J1bGUpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1kYWlseS1zeW5jLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGRhaWx5U3luY1J1bGUpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gR3JhbnQgRXZlbnRCcmlkZ2UgcGVybWlzc2lvbnMgdG8gaW52b2tlIExhbWJkYSBmdW5jdGlvbnNcbiAgICB0aGlzLnJlY29tbWVuZGF0aW9uc0Z1bmN0aW9uLmdyYW50SW52b2tlKG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZXZlbnRzLmFtYXpvbmF3cy5jb20nKSk7XG4gICAgdGhpcy5hbmFseXNpc0Z1bmN0aW9uLmdyYW50SW52b2tlKG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZXZlbnRzLmFtYXpvbmF3cy5jb20nKSk7XG4gICAgdGhpcy5zY3JhcGluZ0Z1bmN0aW9uLmdyYW50SW52b2tlKG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZXZlbnRzLmFtYXpvbmF3cy5jb20nKSk7XG5cbiAgICAvLyBHcmFudCBFdmVudEJyaWRnZSBwZXJtaXNzaW9ucyB0byBzZW5kIG1lc3NhZ2VzIHRvIFNRU1xuICAgIHRoaXMuYmFja2dyb3VuZEpvYnNRdWV1ZS5ncmFudFNlbmRNZXNzYWdlcyhuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2V2ZW50cy5hbWF6b25hd3MuY29tJykpO1xuICAgIHRoaXMuZGVhZExldHRlclF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZXZlbnRzLmFtYXpvbmF3cy5jb20nKSk7XG5cbiAgICAvLyBHcmFudCBMYW1iZGEgZnVuY3Rpb25zIHBlcm1pc3Npb24gdG8gcHVibGlzaCBldmVudHMgdG8gRXZlbnRCcmlkZ2VcbiAgICB0aGlzLmV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8odGhpcy5hbmFseXNpc0Z1bmN0aW9uKTtcbiAgICB0aGlzLmV2ZW50QnVzLmdyYW50UHV0RXZlbnRzVG8odGhpcy5yZWNvbW1lbmRhdGlvbnNGdW5jdGlvbik7XG4gICAgdGhpcy5ldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHRoaXMuc2NyYXBpbmdGdW5jdGlvbik7XG5cbiAgICAvLyBHcmFudCBMYW1iZGEgZnVuY3Rpb25zIHBlcm1pc3Npb24gdG8gc2VuZCBtZXNzYWdlcyB0byBTUVNcbiAgICB0aGlzLmJhY2tncm91bmRKb2JzUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy5hbmFseXNpc0Z1bmN0aW9uKTtcbiAgICB0aGlzLmJhY2tncm91bmRKb2JzUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy5yZWNvbW1lbmRhdGlvbnNGdW5jdGlvbik7XG4gICAgdGhpcy5iYWNrZ3JvdW5kSm9ic1F1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKHRoaXMuc2NyYXBpbmdGdW5jdGlvbik7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRUNTIEZhcmdhdGUgQ2x1c3RlciBmb3IgSGVhdnkgQUkgV29ya2xvYWRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gQ3JlYXRlIENsb3VkV2F0Y2ggbG9nIGdyb3VwIGZvciBFQ1MgdGFza3NcbiAgICBjb25zdCBlY3NMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdFQ1NMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9lY3MvY29kZWZsb3ctd29ya2Vycy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuVFdPX1dFRUtTLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKGVjc0xvZ0dyb3VwKS5hZGQoJ05hbWUnLCBgL2Vjcy9jb2RlZmxvdy13b3JrZXJzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGVjc0xvZ0dyb3VwKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIENyZWF0ZSBFQ1MgQ2x1c3RlclxuICAgIHRoaXMuZWNzQ2x1c3RlciA9IG5ldyBlY3MuQ2x1c3Rlcih0aGlzLCAnQ29kZUZsb3dDbHVzdGVyJywge1xuICAgICAgY2x1c3Rlck5hbWU6IGBjb2RlZmxvdy13b3JrZXJzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgY29udGFpbmVySW5zaWdodHM6IHRydWUsIC8vIEVuYWJsZSBDbG91ZFdhdGNoIENvbnRhaW5lciBJbnNpZ2h0cyBmb3IgbW9uaXRvcmluZ1xuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5lY3NDbHVzdGVyKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctd29ya2Vycy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmVjc0NsdXN0ZXIpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQ3JlYXRlIEVDUiBSZXBvc2l0b3J5IGZvciBEb2NrZXIgaW1hZ2VzXG4gICAgdGhpcy5lY3JSZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdDb2RlRmxvd1dvcmtlcnNSZXBvc2l0b3J5Jywge1xuICAgICAgcmVwb3NpdG9yeU5hbWU6IGBjb2RlZmxvdy13b3JrZXJzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsIC8vIEVuYWJsZSBhdXRvbWF0aWMgaW1hZ2Ugc2Nhbm5pbmcgZm9yIHZ1bG5lcmFiaWxpdGllc1xuICAgICAgaW1hZ2VUYWdNdXRhYmlsaXR5OiBlY3IuVGFnTXV0YWJpbGl0eS5NVVRBQkxFLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOLCAvLyBLZWVwIGltYWdlcyBldmVuIGlmIHN0YWNrIGlzIGRlbGV0ZWRcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlbW92ZSB1bnRhZ2dlZCBpbWFnZXMgYWZ0ZXIgNyBkYXlzJyxcbiAgICAgICAgICB0YWdTdGF0dXM6IGVjci5UYWdTdGF0dXMuVU5UQUdHRUQsXG4gICAgICAgICAgbWF4SW1hZ2VBZ2U6IGNkay5EdXJhdGlvbi5kYXlzKDcpLFxuICAgICAgICAgIHJ1bGVQcmlvcml0eTogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnS2VlcCBsYXN0IDEwIGltYWdlcycsXG4gICAgICAgICAgbWF4SW1hZ2VDb3VudDogMTAsXG4gICAgICAgICAgLy8gTm8gcnVsZVByaW9yaXR5IC0gd2lsbCBiZSBhdXRvLWFzc2lnbmVkIGFzIGhpZ2hlc3QgKFRhZ1N0YXR1cy5BTlkgbXVzdCBiZSBsYXN0KVxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNkay5UYWdzLm9mKHRoaXMuZWNyUmVwb3NpdG9yeSkuYWRkKCdOYW1lJywgYGNvZGVmbG93LXdvcmtlcnMtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5lY3JSZXBvc2l0b3J5KS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIENyZWF0ZSBFQ1MgVGFzayBFeGVjdXRpb24gUm9sZSAoZm9yIHB1bGxpbmcgaW1hZ2VzIGFuZCB3cml0aW5nIGxvZ3MpXG4gICAgdGhpcy5lY3NFeGVjdXRpb25Sb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdFQ1NFeGVjdXRpb25Sb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGBjb2RlZmxvdy1lY3MtZXhlY3V0aW9uLXJvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlY3MtdGFza3MuYW1hem9uYXdzLmNvbScpLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgdGFzayBleGVjdXRpb24gcm9sZSBmb3IgcHVsbGluZyBpbWFnZXMgYW5kIHdyaXRpbmcgbG9ncycsXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQW1hem9uRUNTVGFza0V4ZWN1dGlvblJvbGVQb2xpY3knKSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBFQ1IgcGVybWlzc2lvbnMgdG8gZXhlY3V0aW9uIHJvbGVcbiAgICB0aGlzLmVjclJlcG9zaXRvcnkuZ3JhbnRQdWxsKHRoaXMuZWNzRXhlY3V0aW9uUm9sZSk7XG5cbiAgICAvLyBHcmFudCBDbG91ZFdhdGNoIExvZ3MgcGVybWlzc2lvbnNcbiAgICBlY3NMb2dHcm91cC5ncmFudFdyaXRlKHRoaXMuZWNzRXhlY3V0aW9uUm9sZSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmVjc0V4ZWN1dGlvblJvbGUpLmFkZCgnTmFtZScsIGBjb2RlZmxvdy1lY3MtZXhlY3V0aW9uLXJvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YodGhpcy5lY3NFeGVjdXRpb25Sb2xlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIENyZWF0ZSBFQ1MgVGFzayBSb2xlIChmb3IgYXBwbGljYXRpb24gcGVybWlzc2lvbnM6IEJlZHJvY2ssIER5bmFtb0RCLCBTMylcbiAgICB0aGlzLmVjc1Rhc2tSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdFQ1NUYXNrUm9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiBgY29kZWZsb3ctZWNzLXRhc2stcm9sZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2Vjcy10YXNrcy5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyB0YXNrIHJvbGUgZm9yIHdlYWtuZXNzIGFuYWx5c2lzIHdvcmtlciB3aXRoIEJlZHJvY2sgYW5kIER5bmFtb0RCIHBlcm1pc3Npb25zJyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IER5bmFtb0RCIHBlcm1pc3Npb25zXG4gICAgdGhpcy51c2Vyc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmVjc1Rhc2tSb2xlKTtcbiAgICB0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEodGhpcy5lY3NUYXNrUm9sZSk7XG4gICAgdGhpcy5wcm9ncmVzc1RhYmxlLmdyYW50UmVhZERhdGEodGhpcy5lY3NUYXNrUm9sZSk7XG4gICAgdGhpcy5sbG1DYWNoZVRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmVjc1Rhc2tSb2xlKTtcblxuICAgIC8vIEdyYW50IFMzIHBlcm1pc3Npb25zXG4gICAgdGhpcy5kYXRhc2V0c0J1Y2tldC5ncmFudFJlYWRXcml0ZSh0aGlzLmVjc1Rhc2tSb2xlKTtcblxuICAgIC8vIEdyYW50IEJlZHJvY2sgcGVybWlzc2lvbnNcbiAgICB0aGlzLmVjc1Rhc2tSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWwnLFxuICAgICAgICAnYmVkcm9jazpJbnZva2VNb2RlbFdpdGhSZXNwb25zZVN0cmVhbScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIGBhcm46YXdzOmJlZHJvY2s6JHt0aGlzLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvYW50aHJvcGljLmNsYXVkZS0zLXNvbm5ldC0yMDI0MDIyOS12MTowYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke3RoaXMucmVnaW9ufTo6Zm91bmRhdGlvbi1tb2RlbC9hbnRocm9waWMuY2xhdWRlLTMtaGFpa3UtMjAyNDAzMDctdjE6MGAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IEFXUyBNYXJrZXRwbGFjZSBwZXJtaXNzaW9ucyBmb3IgQmVkcm9jayBtb2RlbCBhY2Nlc3NcbiAgICB0aGlzLmVjc1Rhc2tSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2F3cy1tYXJrZXRwbGFjZTpWaWV3U3Vic2NyaXB0aW9ucycsXG4gICAgICAgICdhd3MtbWFya2V0cGxhY2U6U3Vic2NyaWJlJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFgtUmF5IHBlcm1pc3Npb25zXG4gICAgdGhpcy5lY3NUYXNrUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICd4cmF5OlB1dFRyYWNlU2VnbWVudHMnLFxuICAgICAgICAneHJheTpQdXRUZWxlbWV0cnlSZWNvcmRzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFNRUyBwZXJtaXNzaW9ucyAodG8gcmVjZWl2ZSBtZXNzYWdlcyBmcm9tIGJhY2tncm91bmQgam9icyBxdWV1ZSlcbiAgICB0aGlzLmJhY2tncm91bmRKb2JzUXVldWUuZ3JhbnRDb25zdW1lTWVzc2FnZXModGhpcy5lY3NUYXNrUm9sZSk7XG5cbiAgICBjZGsuVGFncy5vZih0aGlzLmVjc1Rhc2tSb2xlKS5hZGQoJ05hbWUnLCBgY29kZWZsb3ctZWNzLXRhc2stcm9sZS0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih0aGlzLmVjc1Rhc2tSb2xlKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIENyZWF0ZSBGYXJnYXRlIFRhc2sgRGVmaW5pdGlvbiBmb3IgV2Vha25lc3MgQW5hbHlzaXNcbiAgICB0aGlzLmVjc1Rhc2tEZWZpbml0aW9uID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24odGhpcywgJ1dlYWtuZXNzQW5hbHlzaXNUYXNrRGVmaW5pdGlvbicsIHtcbiAgICAgIGZhbWlseTogYGNvZGVmbG93LXdlYWtuZXNzLWFuYWx5c2lzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgICBjcHU6IDIwNDgsIC8vIDIgdkNQVVxuICAgICAgbWVtb3J5TGltaXRNaUI6IDQwOTYsIC8vIDRHQiBSQU1cbiAgICAgIHRhc2tSb2xlOiB0aGlzLmVjc1Rhc2tSb2xlLFxuICAgICAgZXhlY3V0aW9uUm9sZTogdGhpcy5lY3NFeGVjdXRpb25Sb2xlLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YodGhpcy5lY3NUYXNrRGVmaW5pdGlvbikuYWRkKCdOYW1lJywgYGNvZGVmbG93LXdlYWtuZXNzLWFuYWx5c2lzLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKHRoaXMuZWNzVGFza0RlZmluaXRpb24pLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQWRkIGNvbnRhaW5lciB0byB0YXNrIGRlZmluaXRpb25cbiAgICBjb25zdCB3ZWFrbmVzc0FuYWx5c2lzQ29udGFpbmVyID0gdGhpcy5lY3NUYXNrRGVmaW5pdGlvbi5hZGRDb250YWluZXIoJ3dlYWtuZXNzLWFuYWx5emVyJywge1xuICAgICAgY29udGFpbmVyTmFtZTogJ3dlYWtuZXNzLWFuYWx5emVyJyxcbiAgICAgIGltYWdlOiBlY3MuQ29udGFpbmVySW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoXG4gICAgICAgIHRoaXMuZWNyUmVwb3NpdG9yeSxcbiAgICAgICAgJ2xhdGVzdCcgLy8gV2lsbCBiZSB1cGRhdGVkIGR1cmluZyBkZXBsb3ltZW50XG4gICAgICApLFxuICAgICAgZXNzZW50aWFsOiB0cnVlLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgLi4uY29tbW9uRW52aXJvbm1lbnQsXG4gICAgICAgIFdPUktFUl9UWVBFOiAnd2Vha25lc3MtYW5hbHlzaXMnLFxuICAgICAgfSxcbiAgICAgIGxvZ2dpbmc6IGVjcy5Mb2dEcml2ZXJzLmF3c0xvZ3Moe1xuICAgICAgICBzdHJlYW1QcmVmaXg6ICd3ZWFrbmVzcy1hbmFseXNpcycsXG4gICAgICAgIGxvZ0dyb3VwOiBlY3NMb2dHcm91cCxcbiAgICAgIH0pLFxuICAgICAgaGVhbHRoQ2hlY2s6IHtcbiAgICAgICAgY29tbWFuZDogWydDTUQtU0hFTEwnLCAnZWNobyBcImhlYWx0aHlcIiB8fCBleGl0IDEnXSxcbiAgICAgICAgaW50ZXJ2YWw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNSksXG4gICAgICAgIHJldHJpZXM6IDMsXG4gICAgICAgIHN0YXJ0UGVyaW9kOiBjZGsuRHVyYXRpb24uc2Vjb25kcyg2MCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIEV2ZW50QnJpZGdlIHRhcmdldCBmb3IgUHJvZmlsZSBBbmFseXNpcyBDb21wbGV0ZSBldmVudFxuICAgIC8vIFVwZGF0ZSB0aGUgZXhpc3RpbmcgcnVsZSB0byBpbmNsdWRlIEVDUyB0YXNrIGFzIHRhcmdldFxuICAgIHByb2ZpbGVBbmFseXNpc0NvbXBsZXRlUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuRWNzVGFzayh7XG4gICAgICBjbHVzdGVyOiB0aGlzLmVjc0NsdXN0ZXIsXG4gICAgICB0YXNrRGVmaW5pdGlvbjogdGhpcy5lY3NUYXNrRGVmaW5pdGlvbixcbiAgICAgIHRhc2tDb3VudDogMSxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjoge1xuICAgICAgICBzdWJuZXRUeXBlOiBlYzIuU3VibmV0VHlwZS5QUklWQVRFX1dJVEhfRUdSRVNTLFxuICAgICAgfSxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbdGhpcy5lY3NTZWN1cml0eUdyb3VwXSxcbiAgICAgIGNvbnRhaW5lck92ZXJyaWRlczogW1xuICAgICAgICB7XG4gICAgICAgICAgY29udGFpbmVyTmFtZTogJ3dlYWtuZXNzLWFuYWx5emVyJyxcbiAgICAgICAgICBlbnZpcm9ubWVudDogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBuYW1lOiAnRVZFTlRfVFlQRScsXG4gICAgICAgICAgICAgIHZhbHVlOiAnUHJvZmlsZUFuYWx5c2lzQ29tcGxldGUnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIGRlYWRMZXR0ZXJRdWV1ZTogdGhpcy5kZWFkTGV0dGVyUXVldWUsXG4gICAgICBtYXhFdmVudEFnZTogY2RrLkR1cmF0aW9uLmhvdXJzKDIpLFxuICAgICAgcmV0cnlBdHRlbXB0czogMixcbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBFdmVudEJyaWRnZSBwZXJtaXNzaW9ucyB0byBydW4gRUNTIHRhc2tzXG4gICAgdGhpcy5lY3NUYXNrUm9sZS5ncmFudFBhc3NSb2xlKG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZXZlbnRzLmFtYXpvbmF3cy5jb20nKSk7XG4gICAgdGhpcy5lY3NFeGVjdXRpb25Sb2xlLmdyYW50UGFzc1JvbGUobmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdldmVudHMuYW1hem9uYXdzLmNvbScpKTtcblxuICAgIC8vIEdyYW50IEV2ZW50QnJpZGdlIHBlcm1pc3Npb25zIHRvIHJ1biB0YXNrcyBpbiB0aGUgY2x1c3RlclxuICAgIGNvbnN0IGV2ZW50QnJpZGdlRWNzUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnRXZlbnRCcmlkZ2VFQ1NSb2xlJywge1xuICAgICAgcm9sZU5hbWU6IGBjb2RlZmxvdy1ldmVudGJyaWRnZS1lY3Mtcm9sZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2V2ZW50cy5hbWF6b25hd3MuY29tJyksXG4gICAgICBkZXNjcmlwdGlvbjogJ0lBTSByb2xlIGZvciBFdmVudEJyaWRnZSB0byBydW4gRUNTIHRhc2tzJyxcbiAgICB9KTtcblxuICAgIGV2ZW50QnJpZGdlRWNzUm9sZS5hZGRUb1BvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdlY3M6UnVuVGFzaycsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5lY3NUYXNrRGVmaW5pdGlvbi50YXNrRGVmaW5pdGlvbkFybl0sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIEFybkxpa2U6IHtcbiAgICAgICAgICAnZWNzOmNsdXN0ZXInOiB0aGlzLmVjc0NsdXN0ZXIuY2x1c3RlckFybixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgZXZlbnRCcmlkZ2VFY3NSb2xlLmFkZFRvUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2lhbTpQYXNzUm9sZScsXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgIHRoaXMuZWNzVGFza1JvbGUucm9sZUFybixcbiAgICAgICAgdGhpcy5lY3NFeGVjdXRpb25Sb2xlLnJvbGVBcm4sXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBFQ1MgQXV0by1TY2FsaW5nIENvbmZpZ3VyYXRpb25cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBOb3RlOiBBdXRvLXNjYWxpbmcgZm9yIEVDUyBGYXJnYXRlIHRhc2tzIHRyaWdnZXJlZCBieSBFdmVudEJyaWRnZSBpcyBoYW5kbGVkIGRpZmZlcmVudGx5XG4gICAgLy8gdGhhbiB0cmFkaXRpb25hbCBzZXJ2aWNlLWJhc2VkIGF1dG8tc2NhbGluZy4gU2luY2UgdGFza3MgYXJlIHRyaWdnZXJlZCBieSBldmVudHMsXG4gICAgLy8gd2UgcmVseSBvbiBFdmVudEJyaWRnZSdzIGJ1aWx0LWluIGNvbmN1cnJlbmN5IGFuZCB0aGUgU1FTIHF1ZXVlIGRlcHRoLlxuICAgIC8vIFxuICAgIC8vIEZvciBTUVMtYmFzZWQgc2NhbGluZyAoMC0xMCB0YXNrcyBiYXNlZCBvbiBxdWV1ZSBkZXB0aCksIHdlIHdvdWxkIG5lZWQgdG86XG4gICAgLy8gMS4gQ3JlYXRlIGFuIEVDUyBTZXJ2aWNlIChub3QganVzdCB0YXNrIGRlZmluaXRpb24pXG4gICAgLy8gMi4gQ29uZmlndXJlIHRoZSBzZXJ2aWNlIHRvIHBvbGwgU1FTXG4gICAgLy8gMy4gU2V0IHVwIHRhcmdldCB0cmFja2luZyBzY2FsaW5nIGJhc2VkIG9uIFNRUyBBcHByb3hpbWF0ZU51bWJlck9mTWVzc2FnZXNWaXNpYmxlXG4gICAgLy9cbiAgICAvLyBIb3dldmVyLCBzaW5jZSB0aGUgZGVzaWduIHNwZWNpZmllcyBFdmVudEJyaWRnZS10cmlnZ2VyZWQgdGFza3MsIHdlJ2xsIGRvY3VtZW50XG4gICAgLy8gdGhlIHNjYWxpbmcgYXBwcm9hY2ggaW4gdGhlIG91dHB1dHMgYW5kIGNvbW1lbnRzLlxuICAgIC8vXG4gICAgLy8gQWx0ZXJuYXRpdmUgYXBwcm9hY2g6IFVzZSBMYW1iZGEgdG8gbW9uaXRvciBTUVMgZGVwdGggYW5kIHRyaWdnZXIgRUNTIHRhc2tzXG4gICAgLy8gVGhpcyB3b3VsZCBiZSBpbXBsZW1lbnRlZCBpbiBhIGZ1dHVyZSB0YXNrIGlmIG5lZWRlZC5cblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDbG91ZFdhdGNoIERhc2hib2FyZHMgYW5kIEFsYXJtc1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIC8vIENyZWF0ZSBTTlMgdG9waWMgZm9yIGFsYXJtIG5vdGlmaWNhdGlvbnNcbiAgICBjb25zdCBhbGFybVRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnQWxhcm1Ub3BpYycsIHtcbiAgICAgIHRvcGljTmFtZTogYGNvZGVmbG93LWFsYXJtcy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgICAgZGlzcGxheU5hbWU6ICdDb2RlRmxvdyBQbGF0Zm9ybSBBbGFybXMnLFxuICAgIH0pO1xuXG4gICAgY2RrLlRhZ3Mub2YoYWxhcm1Ub3BpYykuYWRkKCdOYW1lJywgYGNvZGVmbG93LWFsYXJtcy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZihhbGFybVRvcGljKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyAxLiBHZW5BSSBQZXJmb3JtYW5jZSBEYXNoYm9hcmRcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBjb25zdCBnZW5BSURhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnR2VuQUlQZXJmb3JtYW5jZURhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBDb2RlRmxvdy1HZW5BSS1QZXJmb3JtYW5jZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgLy8gQmVkcm9jayBBUEkgTGF0ZW5jeSBXaWRnZXRcbiAgICBnZW5BSURhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0JlZHJvY2sgQVBJIExhdGVuY3knLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvZGVGbG93L0dlbkFJJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdCZWRyb2NrTGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUDUwIChBdmVyYWdlKScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb2RlRmxvdy9HZW5BSScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnQmVkcm9ja0xhdGVuY3knLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAncDk1JyxcbiAgICAgICAgICAgIGxhYmVsOiAnUDk1JyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvZGVGbG93L0dlbkFJJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdCZWRyb2NrTGF0ZW5jeScsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdwOTknLFxuICAgICAgICAgICAgbGFiZWw6ICdQOTknLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdFlBeGlzOiB7XG4gICAgICAgICAgbGFiZWw6ICdNaWxsaXNlY29uZHMnLFxuICAgICAgICAgIG1pbjogMCxcbiAgICAgICAgfSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBMTE0gQ2FjaGUgUGVyZm9ybWFuY2UgV2lkZ2V0XG4gICAgZ2VuQUlEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdMTE0gQ2FjaGUgUGVyZm9ybWFuY2UnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvZGVGbG93L0dlbkFJJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdMTE1DYWNoZUhpdFJhdGUnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZScsXG4gICAgICAgICAgICBsYWJlbDogJ0NhY2hlIEhpdCBSYXRlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvZGVGbG93L0dlbkFJJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdMTE1DYWNoZU1pc3NSYXRlJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgbGFiZWw6ICdDYWNoZSBNaXNzIFJhdGUnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdFlBeGlzOiB7XG4gICAgICAgICAgbGFiZWw6ICdQZXJjZW50YWdlJyxcbiAgICAgICAgICBtaW46IDAsXG4gICAgICAgICAgbWF4OiAxMDAsXG4gICAgICAgIH0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gVG9rZW4gVXNhZ2UgJiBDb3N0IFdpZGdldFxuICAgIGdlbkFJRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnVG9rZW4gVXNhZ2UgJiBDb3N0JyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb2RlRmxvdy9HZW5BSScsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnVG9rZW5zVXNlZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdUb3RhbCBUb2tlbnMgVXNlZCcsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQ29kZUZsb3cvR2VuQUknLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0Nvc3RQZXJSZXF1ZXN0JyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnLFxuICAgICAgICAgICAgbGFiZWw6ICdBdmVyYWdlIENvc3QgcGVyIFJlcXVlc3QnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIGxlZnRZQXhpczoge1xuICAgICAgICAgIGxhYmVsOiAnVG9rZW5zJyxcbiAgICAgICAgICBtaW46IDAsXG4gICAgICAgIH0sXG4gICAgICAgIHJpZ2h0WUF4aXM6IHtcbiAgICAgICAgICBsYWJlbDogJ1VTRCcsXG4gICAgICAgICAgbWluOiAwLFxuICAgICAgICB9LFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEJlZHJvY2sgSW52b2NhdGlvbiBDb3VudCBXaWRnZXRcbiAgICBnZW5BSURhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0JlZHJvY2sgSW52b2NhdGlvbnMgYnkgTW9kZWwnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgIG5hbWVzcGFjZTogJ0NvZGVGbG93L0dlbkFJJyxcbiAgICAgICAgICAgIG1ldHJpY05hbWU6ICdCZWRyb2NrSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVG90YWwgSW52b2NhdGlvbnMnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdFlBeGlzOiB7XG4gICAgICAgICAgbGFiZWw6ICdDb3VudCcsXG4gICAgICAgICAgbWluOiAwLFxuICAgICAgICB9LFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIGNkay5UYWdzLm9mKGdlbkFJRGFzaGJvYXJkKS5hZGQoJ05hbWUnLCBgQ29kZUZsb3ctR2VuQUktUGVyZm9ybWFuY2UtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YoZ2VuQUlEYXNoYm9hcmQpLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIDIuIEFQSSBIZWFsdGggRGFzaGJvYXJkXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgYXBpSGVhbHRoRGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdBUElIZWFsdGhEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBgQ29kZUZsb3ctQVBJLUhlYWx0aC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgLy8gQVBJIFJlcXVlc3QgUmF0ZSBXaWRnZXRcbiAgICBhcGlIZWFsdGhEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdBUEkgUmVxdWVzdCBSYXRlJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIHRoaXMucmVzdEFwaS5tZXRyaWNDb3VudCh7XG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdUb3RhbCBSZXF1ZXN0cycsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBsZWZ0WUF4aXM6IHtcbiAgICAgICAgICBsYWJlbDogJ1JlcXVlc3RzJyxcbiAgICAgICAgICBtaW46IDAsXG4gICAgICAgIH0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gQVBJIEVycm9yIFJhdGUgV2lkZ2V0XG4gICAgYXBpSGVhbHRoRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnQVBJIEVycm9yIFJhdGUnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgdGhpcy5yZXN0QXBpLm1ldHJpY0NsaWVudEVycm9yKHtcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBsYWJlbDogJzRYWCBFcnJvcnMnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB0aGlzLnJlc3RBcGkubWV0cmljU2VydmVyRXJyb3Ioe1xuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnNVhYIEVycm9ycycsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBsZWZ0WUF4aXM6IHtcbiAgICAgICAgICBsYWJlbDogJ0Vycm9ycycsXG4gICAgICAgICAgbWluOiAwLFxuICAgICAgICB9LFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIEFQSSBMYXRlbmN5IFdpZGdldCAoUDUwLCBQOTUsIFA5OSlcbiAgICBhcGlIZWFsdGhEYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdBUEkgTGF0ZW5jeScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICB0aGlzLnJlc3RBcGkubWV0cmljTGF0ZW5jeSh7XG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUDUwIChBdmVyYWdlKScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHRoaXMucmVzdEFwaS5tZXRyaWNMYXRlbmN5KHtcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3A5NScsXG4gICAgICAgICAgICBsYWJlbDogJ1A5NScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIHRoaXMucmVzdEFwaS5tZXRyaWNMYXRlbmN5KHtcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ3A5OScsXG4gICAgICAgICAgICBsYWJlbDogJ1A5OScsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBsZWZ0WUF4aXM6IHtcbiAgICAgICAgICBsYWJlbDogJ01pbGxpc2Vjb25kcycsXG4gICAgICAgICAgbWluOiAwLFxuICAgICAgICB9LFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIExhbWJkYSBDb25jdXJyZW50IEV4ZWN1dGlvbnMgV2lkZ2V0XG4gICAgYXBpSGVhbHRoRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnTGFtYmRhIENvbmN1cnJlbnQgRXhlY3V0aW9ucycsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICB0aGlzLmF1dGhGdW5jdGlvbi5tZXRyaWNJbnZvY2F0aW9ucyh7XG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdBdXRoJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgdGhpcy5hbmFseXNpc0Z1bmN0aW9uLm1ldHJpY0ludm9jYXRpb25zKHtcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBsYWJlbDogJ0FuYWx5c2lzJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgdGhpcy5yZWNvbW1lbmRhdGlvbnNGdW5jdGlvbi5tZXRyaWNJbnZvY2F0aW9ucyh7XG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdSZWNvbW1lbmRhdGlvbnMnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB0aGlzLmNoYXRNZW50b3JGdW5jdGlvbi5tZXRyaWNJbnZvY2F0aW9ucyh7XG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdDaGF0IE1lbnRvcicsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBsZWZ0WUF4aXM6IHtcbiAgICAgICAgICBsYWJlbDogJ0ludm9jYXRpb25zJyxcbiAgICAgICAgICBtaW46IDAsXG4gICAgICAgIH0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gRHluYW1vREIgVGhyb3R0bGluZyBFdmVudHMgV2lkZ2V0XG4gICAgYXBpSGVhbHRoRGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnRHluYW1vREIgVGhyb3R0bGluZyBFdmVudHMnLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgdGhpcy51c2Vyc1RhYmxlLm1ldHJpY1VzZXJFcnJvcnMoe1xuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnVXNlcnMgVGFibGUnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZS5tZXRyaWNVc2VyRXJyb3JzKHtcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBsYWJlbDogJ0xlYXJuaW5nIFBhdGhzIFRhYmxlJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgfSksXG4gICAgICAgICAgdGhpcy5wcm9ncmVzc1RhYmxlLm1ldHJpY1VzZXJFcnJvcnMoe1xuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnUHJvZ3Jlc3MgVGFibGUnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICB0aGlzLmxsbUNhY2hlVGFibGUubWV0cmljVXNlckVycm9ycyh7XG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdMTE0gQ2FjaGUgVGFibGUnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdFlBeGlzOiB7XG4gICAgICAgICAgbGFiZWw6ICdUaHJvdHRsZWQgUmVxdWVzdHMnLFxuICAgICAgICAgIG1pbjogMCxcbiAgICAgICAgfSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBjZGsuVGFncy5vZihhcGlIZWFsdGhEYXNoYm9hcmQpLmFkZCgnTmFtZScsIGBDb2RlRmxvdy1BUEktSGVhbHRoLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGFwaUhlYWx0aERhc2hib2FyZCkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gMy4gVXNlciBFbmdhZ2VtZW50IERhc2hib2FyZFxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IHVzZXJFbmdhZ2VtZW50RGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdVc2VyRW5nYWdlbWVudERhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6IGBDb2RlRmxvdy1Vc2VyLUVuZ2FnZW1lbnQtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vIERhaWx5IEFjdGl2ZSBVc2VycyBXaWRnZXRcbiAgICB1c2VyRW5nYWdlbWVudERhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0RhaWx5IEFjdGl2ZSBVc2VycyAoREFVKScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQ29kZUZsb3cvQnVzaW5lc3MnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ0RhaWx5QWN0aXZlVXNlcnMnLFxuICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJyxcbiAgICAgICAgICAgIGxhYmVsOiAnREFVJyxcbiAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmRheXMoMSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIGxlZnRZQXhpczoge1xuICAgICAgICAgIGxhYmVsOiAnVXNlcnMnLFxuICAgICAgICAgIG1pbjogMCxcbiAgICAgICAgfSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICAvLyBQcm9ibGVtcyBTb2x2ZWQgV2lkZ2V0XG4gICAgdXNlckVuZ2FnZW1lbnREYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdQcm9ibGVtcyBTb2x2ZWQgcGVyIERheScsXG4gICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgbmFtZXNwYWNlOiAnQ29kZUZsb3cvQnVzaW5lc3MnLFxuICAgICAgICAgICAgbWV0cmljTmFtZTogJ1Byb2JsZW1zU29sdmVkJyxcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBsYWJlbDogJ1Byb2JsZW1zIFNvbHZlZCcsXG4gICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBsZWZ0WUF4aXM6IHtcbiAgICAgICAgICBsYWJlbDogJ0NvdW50JyxcbiAgICAgICAgICBtaW46IDAsXG4gICAgICAgIH0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgaGVpZ2h0OiA2LFxuICAgICAgfSlcbiAgICApO1xuXG4gICAgLy8gTGVhcm5pbmcgUGF0aHMgR2VuZXJhdGVkIFdpZGdldFxuICAgIHVzZXJFbmdhZ2VtZW50RGFzaGJvYXJkLmFkZFdpZGdldHMoXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnTGVhcm5pbmcgUGF0aHMgR2VuZXJhdGVkJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICBuYW1lc3BhY2U6ICdDb2RlRmxvdy9CdXNpbmVzcycsXG4gICAgICAgICAgICBtZXRyaWNOYW1lOiAnTGVhcm5pbmdQYXRoc0dlbmVyYXRlZCcsXG4gICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nLFxuICAgICAgICAgICAgbGFiZWw6ICdQYXRocyBHZW5lcmF0ZWQnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uZGF5cygxKSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgXSxcbiAgICAgICAgbGVmdFlBeGlzOiB7XG4gICAgICAgICAgbGFiZWw6ICdDb3VudCcsXG4gICAgICAgICAgbWluOiAwLFxuICAgICAgICB9LFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgIGhlaWdodDogNixcbiAgICAgIH0pXG4gICAgKTtcblxuICAgIC8vIENoYXQgTWVudG9yIENvbnZlcnNhdGlvbnMgV2lkZ2V0XG4gICAgdXNlckVuZ2FnZW1lbnREYXNoYm9hcmQuYWRkV2lkZ2V0cyhcbiAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgdGl0bGU6ICdDaGF0IE1lbnRvciBDb252ZXJzYXRpb25zJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIHRoaXMuY2hhdE1lbnRvckZ1bmN0aW9uLm1ldHJpY0ludm9jYXRpb25zKHtcbiAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgICAgICBsYWJlbDogJ1RvdGFsIENvbnZlcnNhdGlvbnMnLFxuICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIGxlZnRZQXhpczoge1xuICAgICAgICAgIGxhYmVsOiAnQ291bnQnLFxuICAgICAgICAgIG1pbjogMCxcbiAgICAgICAgfSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICBoZWlnaHQ6IDYsXG4gICAgICB9KVxuICAgICk7XG5cbiAgICBjZGsuVGFncy5vZih1c2VyRW5nYWdlbWVudERhc2hib2FyZCkuYWRkKCdOYW1lJywgYENvZGVGbG93LVVzZXItRW5nYWdlbWVudC0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZih1c2VyRW5nYWdlbWVudERhc2hib2FyZCkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQ2xvdWRXYXRjaCBBbGFybXNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBBbGFybSAxOiBBUEkgRXJyb3IgUmF0ZSA+IDUlIGZvciA1IG1pbnV0ZXNcbiAgICBjb25zdCBhcGlFcnJvclJhdGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBUElFcnJvclJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYENvZGVGbG93LUFQSS1FcnJvclJhdGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIEFQSSBlcnJvciByYXRlIGV4Y2VlZHMgNSUgZm9yIDUgbWludXRlcycsXG4gICAgICBtZXRyaWM6IHRoaXMucmVzdEFwaS5tZXRyaWNTZXJ2ZXJFcnJvcih7XG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMTAsIC8vIDEwIGVycm9ycyBpbiA1IG1pbnV0ZXMgKGFzc3VtaW5nIH4yMDAgcmVxdWVzdHMgPSA1JSlcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5HUkVBVEVSX1RIQU5fVEhSRVNIT0xELFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkcsXG4gICAgfSk7XG5cbiAgICBhcGlFcnJvclJhdGVBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaF9hY3Rpb25zLlNuc0FjdGlvbihhbGFybVRvcGljKSk7XG4gICAgY2RrLlRhZ3Mub2YoYXBpRXJyb3JSYXRlQWxhcm0pLmFkZCgnTmFtZScsIGBDb2RlRmxvdy1BUEktRXJyb3JSYXRlLSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGFwaUVycm9yUmF0ZUFsYXJtKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnROYW1lKTtcblxuICAgIC8vIEFsYXJtIDI6IEJlZHJvY2sgTGF0ZW5jeSA+IDEwcyAoUDk1KVxuICAgIGNvbnN0IGJlZHJvY2tMYXRlbmN5QWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQmVkcm9ja0xhdGVuY3lBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYENvZGVGbG93LUJlZHJvY2stSGlnaExhdGVuY3ktJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIEJlZHJvY2sgUDk1IGxhdGVuY3kgZXhjZWVkcyAxMCBzZWNvbmRzJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnQ29kZUZsb3cvR2VuQUknLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQmVkcm9ja0xhdGVuY3knLFxuICAgICAgICBzdGF0aXN0aWM6ICdwOTUnLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEwMDAwLCAvLyAxMCBzZWNvbmRzIGluIG1pbGxpc2Vjb25kc1xuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIGJlZHJvY2tMYXRlbmN5QWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuICAgIGNkay5UYWdzLm9mKGJlZHJvY2tMYXRlbmN5QWxhcm0pLmFkZCgnTmFtZScsIGBDb2RlRmxvdy1CZWRyb2NrLUhpZ2hMYXRlbmN5LSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGJlZHJvY2tMYXRlbmN5QWxhcm0pLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQWxhcm0gMzogRHluYW1vREIgVGhyb3R0bGluZyBFdmVudHNcbiAgICBjb25zdCBkeW5hbW9EQlRocm90dGxpbmdBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdEeW5hbW9EQlRocm90dGxpbmdBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYENvZGVGbG93LUR5bmFtb0RCLVRocm90dGxpbmctJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIER5bmFtb0RCIHRocm90dGxpbmcgZXZlbnRzIG9jY3VyJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWF0aEV4cHJlc3Npb24oe1xuICAgICAgICBleHByZXNzaW9uOiAnbTEgKyBtMiArIG0zICsgbTQnLFxuICAgICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgICBtMTogdGhpcy51c2Vyc1RhYmxlLm1ldHJpY1VzZXJFcnJvcnMoeyBzdGF0aXN0aWM6ICdTdW0nLCBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpIH0pLFxuICAgICAgICAgIG0yOiB0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZS5tZXRyaWNVc2VyRXJyb3JzKHsgc3RhdGlzdGljOiAnU3VtJywgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSB9KSxcbiAgICAgICAgICBtMzogdGhpcy5wcm9ncmVzc1RhYmxlLm1ldHJpY1VzZXJFcnJvcnMoeyBzdGF0aXN0aWM6ICdTdW0nLCBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpIH0pLFxuICAgICAgICAgIG00OiB0aGlzLmxsbUNhY2hlVGFibGUubWV0cmljVXNlckVycm9ycyh7IHN0YXRpc3RpYzogJ1N1bScsIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICAgIH0sXG4gICAgICAgIGxhYmVsOiAnVG90YWwgRHluYW1vREIgVGhyb3R0bGluZyBFdmVudHMnLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDUsIC8vIEFsZXJ0IGlmIG1vcmUgdGhhbiA1IHRocm90dGxpbmcgZXZlbnRzIGluIDUgbWludXRlc1xuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIGR5bmFtb0RCVGhyb3R0bGluZ0FsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpKTtcbiAgICBjZGsuVGFncy5vZihkeW5hbW9EQlRocm90dGxpbmdBbGFybSkuYWRkKCdOYW1lJywgYENvZGVGbG93LUR5bmFtb0RCLVRocm90dGxpbmctJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YoZHluYW1vREJUaHJvdHRsaW5nQWxhcm0pLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQWxhcm0gNDogTGFtYmRhIENvbmN1cnJlbnQgRXhlY3V0aW9ucyA+IDgwMFxuICAgIGNvbnN0IGxhbWJkYUNvbmN1cnJlbnRFeGVjdXRpb25zQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhQ29uY3VycmVudEV4ZWN1dGlvbnNBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYENvZGVGbG93LUxhbWJkYS1IaWdoQ29uY3VycmVuY3ktJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIExhbWJkYSBjb25jdXJyZW50IGV4ZWN1dGlvbnMgZXhjZWVkIDgwMCcsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgICAgZXhwcmVzc2lvbjogJ20xICsgbTIgKyBtMyArIG00ICsgbTUnLFxuICAgICAgICB1c2luZ01ldHJpY3M6IHtcbiAgICAgICAgICBtMTogdGhpcy5hdXRoRnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoeyBzdGF0aXN0aWM6ICdTdW0nLCBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpIH0pLFxuICAgICAgICAgIG0yOiB0aGlzLmFuYWx5c2lzRnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoeyBzdGF0aXN0aWM6ICdTdW0nLCBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpIH0pLFxuICAgICAgICAgIG0zOiB0aGlzLnJlY29tbWVuZGF0aW9uc0Z1bmN0aW9uLm1ldHJpY0ludm9jYXRpb25zKHsgc3RhdGlzdGljOiAnU3VtJywgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSB9KSxcbiAgICAgICAgICBtNDogdGhpcy5jaGF0TWVudG9yRnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoeyBzdGF0aXN0aWM6ICdTdW0nLCBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpIH0pLFxuICAgICAgICAgIG01OiB0aGlzLnNjcmFwaW5nRnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoeyBzdGF0aXN0aWM6ICdTdW0nLCBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpIH0pLFxuICAgICAgICB9LFxuICAgICAgICBsYWJlbDogJ1RvdGFsIExhbWJkYSBJbnZvY2F0aW9ucycsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogODAwLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkdSRUFURVJfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIGxhbWJkYUNvbmN1cnJlbnRFeGVjdXRpb25zQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuICAgIGNkay5UYWdzLm9mKGxhbWJkYUNvbmN1cnJlbnRFeGVjdXRpb25zQWxhcm0pLmFkZCgnTmFtZScsIGBDb2RlRmxvdy1MYW1iZGEtSGlnaENvbmN1cnJlbmN5LSR7ZW52aXJvbm1lbnROYW1lfWApO1xuICAgIGNkay5UYWdzLm9mKGxhbWJkYUNvbmN1cnJlbnRFeGVjdXRpb25zQWxhcm0pLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gQWxhcm0gNTogRUNTIFRhc2sgRmFpbHVyZXMgPiAzIGluIDEwIG1pbnV0ZXNcbiAgICBjb25zdCBlY3NUYXNrRmFpbHVyZXNBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdFQ1NUYXNrRmFpbHVyZXNBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYENvZGVGbG93LUVDUy1UYXNrRmFpbHVyZXMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIEVDUyB0YXNrIGZhaWx1cmVzIGV4Y2VlZCAzIGluIDEwIG1pbnV0ZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdBV1MvRUNTJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ1Rhc2tzRmFpbGVkJyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIENsdXN0ZXJOYW1lOiB0aGlzLmVjc0NsdXN0ZXIuY2x1c3Rlck5hbWUsXG4gICAgICAgIH0sXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bScsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuR1JFQVRFUl9USEFOX1RIUkVTSE9MRCxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HLFxuICAgIH0pO1xuXG4gICAgZWNzVGFza0ZhaWx1cmVzQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hfYWN0aW9ucy5TbnNBY3Rpb24oYWxhcm1Ub3BpYykpO1xuICAgIGNkay5UYWdzLm9mKGVjc1Rhc2tGYWlsdXJlc0FsYXJtKS5hZGQoJ05hbWUnLCBgQ29kZUZsb3ctRUNTLVRhc2tGYWlsdXJlcy0ke2Vudmlyb25tZW50TmFtZX1gKTtcbiAgICBjZGsuVGFncy5vZihlY3NUYXNrRmFpbHVyZXNBbGFybSkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50TmFtZSk7XG5cbiAgICAvLyBBbGFybSA2OiBMb3cgQ2FjaGUgSGl0IFJhdGUgPCA0MCVcbiAgICBjb25zdCBsb3dDYWNoZUhpdFJhdGVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMb3dDYWNoZUhpdFJhdGVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogYENvZGVGbG93LUxMTS1Mb3dDYWNoZUhpdFJhdGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGVydCB3aGVuIExMTSBjYWNoZSBoaXQgcmF0ZSBmYWxscyBiZWxvdyA0MCUnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdDb2RlRmxvdy9HZW5BSScsXG4gICAgICAgIG1ldHJpY05hbWU6ICdMTE1DYWNoZUhpdFJhdGUnLFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNDAsIC8vIEJlbG93IDQwJSBoaXQgcmF0ZVxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkxFU1NfVEhBTl9USFJFU0hPTEQsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElORyxcbiAgICB9KTtcblxuICAgIGxvd0NhY2hlSGl0UmF0ZUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoX2FjdGlvbnMuU25zQWN0aW9uKGFsYXJtVG9waWMpKTtcbiAgICBjZGsuVGFncy5vZihsb3dDYWNoZUhpdFJhdGVBbGFybSkuYWRkKCdOYW1lJywgYENvZGVGbG93LUxMTS1Mb3dDYWNoZUhpdFJhdGUtJHtlbnZpcm9ubWVudE5hbWV9YCk7XG4gICAgY2RrLlRhZ3Mub2YobG93Q2FjaGVIaXRSYXRlQWxhcm0pLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudE5hbWUpO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEFQSSBHYXRld2F5IExhbWJkYSBJbnRlZ3JhdGlvbnNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICAvLyBJbnRlcnZpZXcgU2ltdWxhdG9yIEFQSSBlbmRwb2ludHNcbiAgICBjb25zdCBpbnRlcnZpZXdJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuaW50ZXJ2aWV3U2ltdWxhdG9yRnVuY3Rpb24sIHtcbiAgICAgIHByb3h5OiB0cnVlLFxuICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInKidcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIFBPU1QgL2ludGVydmlldy9zdGFydFxuICAgIGNvbnN0IHN0YXJ0UmVzb3VyY2UgPSBpbnRlcnZpZXdSZXNvdXJjZS5hZGRSZXNvdXJjZSgnc3RhcnQnKTtcbiAgICBzdGFydFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGludGVydmlld0ludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiB0aGlzLmp3dEF1dGhvcml6ZXIsXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIFBPU1QgL2ludGVydmlldy9zdWJtaXRcbiAgICBjb25zdCBzdWJtaXRSZXNvdXJjZSA9IGludGVydmlld1Jlc291cmNlLmFkZFJlc291cmNlKCdzdWJtaXQnKTtcbiAgICBzdWJtaXRSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBpbnRlcnZpZXdJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcjogdGhpcy5qd3RBdXRob3JpemVyLFxuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9pbnRlcnZpZXcvYmVoYXZpb3JhbFxuICAgIGNvbnN0IGJlaGF2aW9yYWxSZXNvdXJjZSA9IGludGVydmlld1Jlc291cmNlLmFkZFJlc291cmNlKCdiZWhhdmlvcmFsJyk7XG4gICAgYmVoYXZpb3JhbFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGludGVydmlld0ludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiB0aGlzLmp3dEF1dGhvcml6ZXIsXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdFVCAvaW50ZXJ2aWV3L3tzZXNzaW9uX2lkfS9mZWVkYmFja1xuICAgIGNvbnN0IHNlc3Npb25JZFJlc291cmNlID0gaW50ZXJ2aWV3UmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tzZXNzaW9uX2lkfScpO1xuICAgIGNvbnN0IGZlZWRiYWNrUmVzb3VyY2UgPSBzZXNzaW9uSWRSZXNvdXJjZS5hZGRSZXNvdXJjZSgnZmVlZGJhY2snKTtcbiAgICBmZWVkYmFja1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgaW50ZXJ2aWV3SW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXI6IHRoaXMuand0QXV0aG9yaXplcixcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR0VUIC9pbnRlcnZpZXcve3Nlc3Npb25faWR9L3N0YXR1c1xuICAgIGNvbnN0IHN0YXR1c1Jlc291cmNlID0gc2Vzc2lvbklkUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3N0YXR1cycpO1xuICAgIHN0YXR1c1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgaW50ZXJ2aWV3SW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXI6IHRoaXMuand0QXV0aG9yaXplcixcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIEF1dGggQVBJIGVuZHBvaW50c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIGNvbnN0IGF1dGhJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuYXV0aEZ1bmN0aW9uLCB7XG4gICAgICBwcm94eTogdHJ1ZSxcbiAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9hdXRoL3JlZ2lzdGVyXG4gICAgY29uc3QgcmVnaXN0ZXJSZXNvdXJjZSA9IGF1dGhSZXNvdXJjZS5hZGRSZXNvdXJjZSgncmVnaXN0ZXInKTtcbiAgICByZWdpc3RlclJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGF1dGhJbnRlZ3JhdGlvbiwge1xuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9hdXRoL2xvZ2luXG4gICAgY29uc3QgbG9naW5SZXNvdXJjZSA9IGF1dGhSZXNvdXJjZS5hZGRSZXNvdXJjZSgnbG9naW4nKTtcbiAgICBsb2dpblJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGF1dGhJbnRlZ3JhdGlvbiwge1xuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9hdXRoL3JlZnJlc2hcbiAgICBjb25zdCByZWZyZXNoUmVzb3VyY2UgPSBhdXRoUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3JlZnJlc2gnKTtcbiAgICByZWZyZXNoUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgYXV0aEludGVncmF0aW9uLCB7XG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBbmFseXNpcyBBUEkgZW5kcG9pbnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgYW5hbHlzaXNJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuYW5hbHlzaXNGdW5jdGlvbiwge1xuICAgICAgcHJveHk6IHRydWUsXG4gICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIicqJ1wiLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR0VUIC9hbmFseXplL3t1c2VyX2lkfS90b3BpY3NcbiAgICBjb25zdCB1c2VySWRSZXNvdXJjZSA9IGFuYWx5emVSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3VzZXJfaWR9Jyk7XG4gICAgY29uc3QgdG9waWNzUmVzb3VyY2UgPSB1c2VySWRSZXNvdXJjZS5hZGRSZXNvdXJjZSgndG9waWNzJyk7XG4gICAgdG9waWNzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBhbmFseXNpc0ludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiB0aGlzLmp3dEF1dGhvcml6ZXIsXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIFBPU1QgL2FuYWx5emUvcHJvZmlsZVxuICAgIGNvbnN0IHByb2ZpbGVSZXNvdXJjZSA9IGFuYWx5emVSZXNvdXJjZS5hZGRSZXNvdXJjZSgncHJvZmlsZScpO1xuICAgIHByb2ZpbGVSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBhbmFseXNpc0ludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiB0aGlzLmp3dEF1dGhvcml6ZXIsXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBQcm9ncmVzcyBBUEkgZW5kcG9pbnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgcHJvZ3Jlc3NJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHRoaXMuYW5hbHlzaXNGdW5jdGlvbiwge1xuICAgICAgcHJveHk6IHRydWUsXG4gICAgICBpbnRlZ3JhdGlvblJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiBcIicqJ1wiLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR0VUIC9wcm9ncmVzcy97dXNlcl9pZH1cbiAgICBjb25zdCBwcm9ncmVzc1VzZXJJZFJlc291cmNlID0gcHJvZ3Jlc3NSZXNvdXJjZS5hZGRSZXNvdXJjZSgne3VzZXJfaWR9Jyk7XG4gICAgcHJvZ3Jlc3NVc2VySWRSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIHByb2dyZXNzSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXI6IHRoaXMuand0QXV0aG9yaXplcixcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFJlY29tbWVuZGF0aW9ucyBBUEkgZW5kcG9pbnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgcmVjb21tZW5kYXRpb25zSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbih0aGlzLnJlY29tbWVuZGF0aW9uc0Z1bmN0aW9uLCB7XG4gICAgICBwcm94eTogdHJ1ZSxcbiAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJyonXCIsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9yZWNvbW1lbmRhdGlvbnMvZ2VuZXJhdGUtcGF0aFxuICAgIGNvbnN0IGdlbmVyYXRlUGF0aFJlc291cmNlID0gcmVjb21tZW5kYXRpb25zUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2dlbmVyYXRlLXBhdGgnKTtcbiAgICBnZW5lcmF0ZVBhdGhSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCByZWNvbW1lbmRhdGlvbnNJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcjogdGhpcy5qd3RBdXRob3JpemVyLFxuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL3JlY29tbWVuZGF0aW9ucy9uZXh0LXByb2JsZW1cbiAgICBjb25zdCBuZXh0UHJvYmxlbVJlc291cmNlID0gcmVjb21tZW5kYXRpb25zUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ25leHQtcHJvYmxlbScpO1xuICAgIG5leHRQcm9ibGVtUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCByZWNvbW1lbmRhdGlvbnNJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcjogdGhpcy5qd3RBdXRob3JpemVyLFxuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBQT1NUIC9yZWNvbW1lbmRhdGlvbnMvaGludFxuICAgIGNvbnN0IGhpbnRSZXNvdXJjZSA9IHJlY29tbWVuZGF0aW9uc1Jlc291cmNlLmFkZFJlc291cmNlKCdoaW50Jyk7XG4gICAgaGludFJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIHJlY29tbWVuZGF0aW9uc0ludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiB0aGlzLmp3dEF1dGhvcml6ZXIsXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDaGF0IE1lbnRvciBBUEkgZW5kcG9pbnRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgY29uc3QgY2hhdE1lbnRvckludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24odGhpcy5jaGF0TWVudG9yRnVuY3Rpb24sIHtcbiAgICAgIHByb3h5OiB0cnVlLFxuICAgICAgaW50ZWdyYXRpb25SZXNwb25zZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1c0NvZGU6ICcyMDAnLFxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogXCInKidcIixcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSAvY2hhdC1tZW50b3IgcmVzb3VyY2VcbiAgICBjb25zdCBjaGF0TWVudG9yUmVzb3VyY2UgPSB0aGlzLnJlc3RBcGkucm9vdC5hZGRSZXNvdXJjZSgnY2hhdC1tZW50b3InKTtcblxuICAgIC8vIFBPU1QgL2NoYXQtbWVudG9yXG4gICAgY2hhdE1lbnRvclJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGNoYXRNZW50b3JJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcjogdGhpcy5qd3RBdXRob3JpemVyLFxuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL2NoYXQtbWVudG9yL3t1c2VyX2lkfS9oaXN0b3J5XG4gICAgY29uc3QgY2hhdE1lbnRvclVzZXJJZFJlc291cmNlID0gY2hhdE1lbnRvclJlc291cmNlLmFkZFJlc291cmNlKCd7dXNlcl9pZH0nKTtcbiAgICBjb25zdCBoaXN0b3J5UmVzb3VyY2UgPSBjaGF0TWVudG9yVXNlcklkUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ2hpc3RvcnknKTtcbiAgICBoaXN0b3J5UmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBjaGF0TWVudG9ySW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXI6IHRoaXMuand0QXV0aG9yaXplcixcbiAgICAgIG1ldGhvZFJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXG4gICAgICAgICAgcmVzcG9uc2VQYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuICAgIC8vIFN0YWNrIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVlBDSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy52cGMudnBjSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZQQyBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctVlBDLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVlBDQ2lkcicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy52cGNDaWRyQmxvY2ssXG4gICAgICBkZXNjcmlwdGlvbjogJ1ZQQyBDSURSIEJsb2NrJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQdWJsaWNTdWJuZXRzJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLnB1YmxpY1N1Ym5ldHMubWFwKHN1Ym5ldCA9PiBzdWJuZXQuc3VibmV0SWQpLmpvaW4oJywnKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUHVibGljIFN1Ym5ldCBJRHMnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LVB1YmxpY1N1Ym5ldHMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcml2YXRlU3VibmV0cycsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnZwYy5wcml2YXRlU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCkuam9pbignLCcpLFxuICAgICAgZGVzY3JpcHRpb246ICdQcml2YXRlIFN1Ym5ldCBJRHMnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LVByaXZhdGVTdWJuZXRzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnSXNvbGF0ZWRTdWJuZXRzJywge1xuICAgICAgdmFsdWU6IHRoaXMudnBjLmlzb2xhdGVkU3VibmV0cy5tYXAoc3VibmV0ID0+IHN1Ym5ldC5zdWJuZXRJZCkuam9pbignLCcpLFxuICAgICAgZGVzY3JpcHRpb246ICdJc29sYXRlZCBTdWJuZXQgSURzJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1Jc29sYXRlZFN1Ym5ldHMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMYW1iZGFTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwLnNlY3VyaXR5R3JvdXBJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGFtYmRhIFNlY3VyaXR5IEdyb3VwIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1MYW1iZGFTRy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09wZW5TZWFyY2hTZWN1cml0eUdyb3VwSWQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5vcGVuU2VhcmNoU2VjdXJpdHlHcm91cC5zZWN1cml0eUdyb3VwSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ09wZW5TZWFyY2ggU2VjdXJpdHkgR3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LU9wZW5TZWFyY2hTRy0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VDU1NlY3VyaXR5R3JvdXBJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmVjc1NlY3VyaXR5R3JvdXAuc2VjdXJpdHlHcm91cElkLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgU2VjdXJpdHkgR3JvdXAgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUVDU1NHLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRW52aXJvbm1lbnQgQ29uZmlndXJhdGlvbiBPdXRwdXRcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRW52aXJvbm1lbnQnLCB7XG4gICAgICB2YWx1ZTogZW52aXJvbm1lbnROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdEZXBsb3ltZW50IEVudmlyb25tZW50JyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZWdpb24nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZWdpb24sXG4gICAgICBkZXNjcmlwdGlvbjogJ0FXUyBSZWdpb24nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FjY291bnQnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hY2NvdW50LFxuICAgICAgZGVzY3JpcHRpb246ICdBV1MgQWNjb3VudCBJRCcsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gRHluYW1vREIgVGFibGUgT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2Vyc1RhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJzVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdVc2VycyBUYWJsZSBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1Vc2Vyc1RhYmxlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlcnNUYWJsZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnVzZXJzVGFibGUudGFibGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1VzZXJzIFRhYmxlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTGVhcm5pbmdQYXRoc1RhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0xlYXJuaW5nIFBhdGhzIFRhYmxlIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUxlYXJuaW5nUGF0aHNUYWJsZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xlYXJuaW5nUGF0aHNUYWJsZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmxlYXJuaW5nUGF0aHNUYWJsZS50YWJsZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGVhcm5pbmcgUGF0aHMgVGFibGUgQVJOJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQcm9ncmVzc1RhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByb2dyZXNzVGFibGUudGFibGVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdQcm9ncmVzcyBUYWJsZSBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1Qcm9ncmVzc1RhYmxlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUHJvZ3Jlc3NUYWJsZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnByb2dyZXNzVGFibGUudGFibGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1Byb2dyZXNzIFRhYmxlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTExNQ2FjaGVUYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5sbG1DYWNoZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTExNIENhY2hlIFRhYmxlIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUxMTUNhY2hlVGFibGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMTE1DYWNoZVRhYmxlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMubGxtQ2FjaGVUYWJsZS50YWJsZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnTExNIENhY2hlIFRhYmxlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29udmVyc2F0aW9uSGlzdG9yeVRhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnNhdGlvbiBIaXN0b3J5IFRhYmxlIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZS0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZUFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmNvbnZlcnNhdGlvbkhpc3RvcnlUYWJsZS50YWJsZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29udmVyc2F0aW9uIEhpc3RvcnkgVGFibGUgQVJOJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdLbm93bGVkZ2VCYXNlVGFibGVOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMua25vd2xlZGdlQmFzZVRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnS25vd2xlZGdlIEJhc2UgVGFibGUgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctS25vd2xlZGdlQmFzZVRhYmxlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnS25vd2xlZGdlQmFzZVRhYmxlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMua25vd2xlZGdlQmFzZVRhYmxlLnRhYmxlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdLbm93bGVkZ2UgQmFzZSBUYWJsZSBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FuYWx5dGljc1RhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmFuYWx5dGljc1RhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQW5hbHl0aWNzIFRhYmxlIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUFuYWx5dGljc1RhYmxlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQW5hbHl0aWNzVGFibGVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hbmFseXRpY3NUYWJsZS50YWJsZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQW5hbHl0aWNzIFRhYmxlIEFSTicsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gUzMgQnVja2V0IE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU3RhdGljQXNzZXRzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnN0YXRpY0Fzc2V0c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTdGF0aWMgQXNzZXRzIEJ1Y2tldCBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1TdGF0aWNBc3NldHNCdWNrZXQtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTdGF0aWNBc3NldHNCdWNrZXRBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zdGF0aWNBc3NldHNCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTdGF0aWMgQXNzZXRzIEJ1Y2tldCBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0tCRG9jdW1lbnRzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmtiRG9jdW1lbnRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0tub3dsZWRnZSBCYXNlIERvY3VtZW50cyBCdWNrZXQgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctS0JEb2N1bWVudHNCdWNrZXQtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdLQkRvY3VtZW50c0J1Y2tldEFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmtiRG9jdW1lbnRzQnVja2V0LmJ1Y2tldEFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnS25vd2xlZGdlIEJhc2UgRG9jdW1lbnRzIEJ1Y2tldCBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RhdGFzZXRzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmRhdGFzZXRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RhdGFzZXRzIEJ1Y2tldCBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1EYXRhc2V0c0J1Y2tldC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RhdGFzZXRzQnVja2V0QXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZGF0YXNldHNCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdEYXRhc2V0cyBCdWNrZXQgQVJOJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBPcGVuU2VhcmNoIERvbWFpbiBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09wZW5TZWFyY2hEb21haW5OYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMub3BlblNlYXJjaERvbWFpbi5kb21haW5OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdPcGVuU2VhcmNoIERvbWFpbiBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1PcGVuU2VhcmNoRG9tYWluLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnT3BlblNlYXJjaERvbWFpbkFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9wZW5TZWFyY2hEb21haW4uZG9tYWluQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdPcGVuU2VhcmNoIERvbWFpbiBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09wZW5TZWFyY2hEb21haW5FbmRwb2ludCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLm9wZW5TZWFyY2hEb21haW4uZG9tYWluRW5kcG9pbnQsXG4gICAgICBkZXNjcmlwdGlvbjogJ09wZW5TZWFyY2ggRG9tYWluIEVuZHBvaW50JyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1PcGVuU2VhcmNoRW5kcG9pbnQtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPcGVuU2VhcmNoRGFzaGJvYXJkc1VybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMub3BlblNlYXJjaERvbWFpbi5kb21haW5FbmRwb2ludH0vX2Rhc2hib2FyZHNgLFxuICAgICAgZGVzY3JpcHRpb246ICdPcGVuU2VhcmNoIERhc2hib2FyZHMgVVJMJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBBUEkgR2F0ZXdheSBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1Jlc3RBcGlJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnJlc3RBcGkucmVzdEFwaUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdSRVNUIEFQSSBHYXRld2F5IElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1SZXN0QXBpSWQtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdSZXN0QXBpVXJsJywge1xuICAgICAgdmFsdWU6IHRoaXMucmVzdEFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JFU1QgQVBJIEdhdGV3YXkgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1SZXN0QXBpVXJsLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVzdEFwaVJvb3RSZXNvdXJjZUlkJywge1xuICAgICAgdmFsdWU6IHRoaXMucmVzdEFwaS5yb290LnJlc291cmNlSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JFU1QgQVBJIFJvb3QgUmVzb3VyY2UgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LVJlc3RBcGlSb290UmVzb3VyY2VJZC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0pXVEF1dGhvcml6ZXJBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5qd3RBdXRob3JpemVyLmF1dGhvcml6ZXJBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0pXVCBMYW1iZGEgQXV0aG9yaXplciBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUpXVEF1dGhvcml6ZXJBcm4tJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBMYW1iZGEgRnVuY3Rpb24gT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTaGFyZWREZXBlbmRlbmNpZXNMYXllckFybicsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNoYXJlZERlcGVuZGVuY2llc0xheWVyLmxheWVyVmVyc2lvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2hhcmVkIERlcGVuZGVuY2llcyBMYW1iZGEgTGF5ZXIgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1TaGFyZWREZXBlbmRlbmNpZXNMYXllci0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0F1dGhGdW5jdGlvbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hdXRoRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdBdXRoIExhbWJkYSBGdW5jdGlvbiBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1BdXRoRnVuY3Rpb24tJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBdXRoRnVuY3Rpb25Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hdXRoRnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1dGggTGFtYmRhIEZ1bmN0aW9uIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQW5hbHlzaXNGdW5jdGlvbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hbmFseXNpc0Z1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQW5hbHlzaXMgTGFtYmRhIEZ1bmN0aW9uIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUFuYWx5c2lzRnVuY3Rpb24tJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbmFseXNpc0Z1bmN0aW9uQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYW5hbHlzaXNGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQW5hbHlzaXMgTGFtYmRhIEZ1bmN0aW9uIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVjb21tZW5kYXRpb25zRnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMucmVjb21tZW5kYXRpb25zRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdSZWNvbW1lbmRhdGlvbnMgTGFtYmRhIEZ1bmN0aW9uIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LVJlY29tbWVuZGF0aW9uc0Z1bmN0aW9uLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnUmVjb21tZW5kYXRpb25zRnVuY3Rpb25Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5yZWNvbW1lbmRhdGlvbnNGdW5jdGlvbi5mdW5jdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnUmVjb21tZW5kYXRpb25zIExhbWJkYSBGdW5jdGlvbiBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NoYXRNZW50b3JGdW5jdGlvbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5jaGF0TWVudG9yRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDaGF0IE1lbnRvciBMYW1iZGEgRnVuY3Rpb24gTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctQ2hhdE1lbnRvckZ1bmN0aW9uLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2hhdE1lbnRvckZ1bmN0aW9uQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuY2hhdE1lbnRvckZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdDaGF0IE1lbnRvciBMYW1iZGEgRnVuY3Rpb24gQVJOJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTY3JhcGluZ0Z1bmN0aW9uTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLnNjcmFwaW5nRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdTY3JhcGluZyBMYW1iZGEgRnVuY3Rpb24gTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctU2NyYXBpbmdGdW5jdGlvbi0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1NjcmFwaW5nRnVuY3Rpb25Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5zY3JhcGluZ0Z1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTY3JhcGluZyBMYW1iZGEgRnVuY3Rpb24gQVJOJyxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBFdmVudEJyaWRnZSBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0V2ZW50QnVzTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmV2ZW50QnVzLmV2ZW50QnVzTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2UgRXZlbnQgQnVzIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUV2ZW50QnVzLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRXZlbnRCdXNBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5ldmVudEJ1cy5ldmVudEJ1c0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnRXZlbnRCcmlkZ2UgRXZlbnQgQnVzIEFSTicsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gU1FTIFF1ZXVlIE91dHB1dHNcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmFja2dyb3VuZEpvYnNRdWV1ZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5iYWNrZ3JvdW5kSm9ic1F1ZXVlLnF1ZXVlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmFja2dyb3VuZCBKb2JzIFF1ZXVlIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUJhY2tncm91bmRKb2JzUXVldWUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCYWNrZ3JvdW5kSm9ic1F1ZXVlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmFja2dyb3VuZEpvYnNRdWV1ZS5xdWV1ZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmFja2dyb3VuZCBKb2JzIFF1ZXVlIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmFja2dyb3VuZEpvYnNRdWV1ZVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmJhY2tncm91bmRKb2JzUXVldWUucXVldWVVcmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0JhY2tncm91bmQgSm9icyBRdWV1ZSBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUJhY2tncm91bmRKb2JzUXVldWVVcmwtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEZWFkTGV0dGVyUXVldWVOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZGVhZExldHRlclF1ZXVlLnF1ZXVlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVhZCBMZXR0ZXIgUXVldWUgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctRGVhZExldHRlclF1ZXVlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGVhZExldHRlclF1ZXVlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZGVhZExldHRlclF1ZXVlLnF1ZXVlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdEZWFkIExldHRlciBRdWV1ZSBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RlYWRMZXR0ZXJRdWV1ZVVybCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmRlYWRMZXR0ZXJRdWV1ZS5xdWV1ZVVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVhZCBMZXR0ZXIgUXVldWUgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1EZWFkTGV0dGVyUXVldWVVcmwtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBFQ1MgRmFyZ2F0ZSBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VDU0NsdXN0ZXJOYW1lJywge1xuICAgICAgdmFsdWU6IHRoaXMuZWNzQ2x1c3Rlci5jbHVzdGVyTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIENsdXN0ZXIgTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctRUNTQ2x1c3Rlci0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0VDU0NsdXN0ZXJBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3NDbHVzdGVyLmNsdXN0ZXJBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0VDUyBDbHVzdGVyIEFSTicsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRUNSUmVwb3NpdG9yeU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3JSZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1IgUmVwb3NpdG9yeSBOYW1lJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1FQ1JSZXBvc2l0b3J5LSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRUNSUmVwb3NpdG9yeVVyaScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmVjclJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNSIFJlcG9zaXRvcnkgVVJJJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1FQ1JSZXBvc2l0b3J5VXJpLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRUNTVGFza0RlZmluaXRpb25Bcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3NUYXNrRGVmaW5pdGlvbi50YXNrRGVmaW5pdGlvbkFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIFRhc2sgRGVmaW5pdGlvbiBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUVDU1Rhc2tEZWZpbml0aW9uLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRUNTVGFza1JvbGVBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5lY3NUYXNrUm9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgVGFzayBSb2xlIEFSTicsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctRUNTVGFza1JvbGUtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdFQ1NFeGVjdXRpb25Sb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuZWNzRXhlY3V0aW9uUm9sZS5yb2xlQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdFQ1MgRXhlY3V0aW9uIFJvbGUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1FQ1NFeGVjdXRpb25Sb2xlLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRUNTTG9nR3JvdXBOYW1lJywge1xuICAgICAgdmFsdWU6IGAvZWNzL2NvZGVmbG93LXdvcmtlcnMtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRUNTIENsb3VkV2F0Y2ggTG9nIEdyb3VwIE5hbWUnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUVDU0xvZ0dyb3VwLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4gICAgLy8gQmVkcm9jayBLbm93bGVkZ2UgQmFzZSBPdXRwdXRzXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4gICAgLy8gVE9ETzogVGVtcG9yYXJpbHkgZGlzYWJsZWQgLSBkZXBlbmRzIG9uIEJlZHJvY2sgS25vd2xlZGdlIEJhc2VcbiAgICAvKlxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCZWRyb2NrS25vd2xlZGdlQmFzZUlkJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2UuYXR0cktub3dsZWRnZUJhc2VJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmVkcm9jayBLbm93bGVkZ2UgQmFzZSBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgQ29kZUZsb3ctQmVkcm9ja0tub3dsZWRnZUJhc2VJZC0ke2Vudmlyb25tZW50TmFtZX1gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0JlZHJvY2tLbm93bGVkZ2VCYXNlTmFtZScsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmJlZHJvY2tLbm93bGVkZ2VCYXNlLm5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgS25vd2xlZGdlIEJhc2UgTmFtZScsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmVkcm9ja0tub3dsZWRnZUJhc2VBcm4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5iZWRyb2NrS25vd2xlZGdlQmFzZS5hdHRyS25vd2xlZGdlQmFzZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmVkcm9jayBLbm93bGVkZ2UgQmFzZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUJlZHJvY2tLbm93bGVkZ2VCYXNlQXJuLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmVkcm9ja0RhdGFTb3VyY2VJZCcsIHtcbiAgICAgIHZhbHVlOiB0aGlzLmJlZHJvY2tEYXRhU291cmNlLmF0dHJEYXRhU291cmNlSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgRGF0YSBTb3VyY2UgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYENvZGVGbG93LUJlZHJvY2tEYXRhU291cmNlSWQtJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCZWRyb2NrRGF0YVNvdXJjZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5iZWRyb2NrRGF0YVNvdXJjZS5uYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdCZWRyb2NrIERhdGEgU291cmNlIE5hbWUnLFxuICAgIH0pO1xuICAgICovXG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQmVkcm9ja0tub3dsZWRnZUJhc2VSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IHRoaXMuYmVkcm9ja0tub3dsZWRnZUJhc2VSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0JlZHJvY2sgS25vd2xlZGdlIEJhc2UgSUFNIFJvbGUgQVJOJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1CZWRyb2NrS25vd2xlZGdlQmFzZVJvbGVBcm4tJHtlbnZpcm9ubWVudE5hbWV9YCxcbiAgICB9KTtcblxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbiAgICAvLyBDbG91ZFdhdGNoIGFuZCBTTlMgT3V0cHV0c1xuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBbGFybVRvcGljQXJuJywge1xuICAgICAgdmFsdWU6IGFsYXJtVG9waWMudG9waWNBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NOUyBUb3BpYyBBUk4gZm9yIENsb3VkV2F0Y2ggQWxhcm1zJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBDb2RlRmxvdy1BbGFybVRvcGljLSR7ZW52aXJvbm1lbnROYW1lfWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWxhcm1Ub3BpY05hbWUnLCB7XG4gICAgICB2YWx1ZTogYWxhcm1Ub3BpYy50b3BpY05hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NOUyBUb3BpYyBOYW1lIGZvciBDbG91ZFdhdGNoIEFsYXJtcycsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnR2VuQUlEYXNoYm9hcmROYW1lJywge1xuICAgICAgdmFsdWU6IGdlbkFJRGFzaGJvYXJkLmRhc2hib2FyZE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0dlbkFJIFBlcmZvcm1hbmNlIERhc2hib2FyZCBOYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBUElIZWFsdGhEYXNoYm9hcmROYW1lJywge1xuICAgICAgdmFsdWU6IGFwaUhlYWx0aERhc2hib2FyZC5kYXNoYm9hcmROYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgSGVhbHRoIERhc2hib2FyZCBOYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyRW5nYWdlbWVudERhc2hib2FyZE5hbWUnLCB7XG4gICAgICB2YWx1ZTogdXNlckVuZ2FnZW1lbnREYXNoYm9hcmQuZGFzaGJvYXJkTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnVXNlciBFbmdhZ2VtZW50IERhc2hib2FyZCBOYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZFdhdGNoRGFzaGJvYXJkc1VybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly9jb25zb2xlLmF3cy5hbWF6b24uY29tL2Nsb3Vkd2F0Y2gvaG9tZT9yZWdpb249JHt0aGlzLnJlZ2lvbn0jZGFzaGJvYXJkczpgLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIERhc2hib2FyZHMgQ29uc29sZSBVUkwnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkV2F0Y2hBbGFybXNVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7dGhpcy5yZWdpb259I2FsYXJtc1YyOmAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggQWxhcm1zIENvbnNvbGUgVVJMJyxcbiAgICB9KTtcbiAgfVxufVxuIl19