import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as applicationautoscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';

export interface CodeFlowInfrastructureStackProps extends cdk.StackProps {
  environmentName: string;
}

export class CodeFlowInfrastructureStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly openSearchSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  
  // DynamoDB Tables
  public readonly usersTable: dynamodb.Table;
  public readonly learningPathsTable: dynamodb.Table;
  public readonly progressTable: dynamodb.Table;
  public readonly llmCacheTable: dynamodb.Table;
  public readonly conversationHistoryTable: dynamodb.Table;
  public readonly knowledgeBaseTable: dynamodb.Table;
  public readonly analyticsTable: dynamodb.Table;
  public readonly interviewSessionsTable: dynamodb.Table;

  // S3 Buckets
  public readonly staticAssetsBucket: s3.Bucket;
  public readonly kbDocumentsBucket: s3.Bucket;
  public readonly datasetsBucket: s3.Bucket;

  // OpenSearch Domain
  public readonly openSearchDomain: opensearch.Domain;

  // Bedrock Knowledge Base
  public readonly bedrockKnowledgeBase: cdk.aws_bedrock.CfnKnowledgeBase;
  public readonly bedrockDataSource: cdk.aws_bedrock.CfnDataSource;
  public readonly bedrockKnowledgeBaseRole: iam.Role;

  // API Gateway
  public readonly restApi: apigateway.RestApi;
  public readonly jwtAuthorizer: apigateway.RequestAuthorizer;

  // Lambda Layer
  public readonly sharedDependenciesLayer: lambda.LayerVersion;

  // Lambda Functions
  public readonly authFunction: lambda.Function;
  public readonly analysisFunction: lambda.Function;
  public readonly recommendationsFunction: lambda.Function;
  public readonly chatMentorFunction: lambda.Function;
  public readonly scrapingFunction: lambda.Function;
  public readonly interviewSimulatorFunction: lambda.Function;

  // EventBridge
  public readonly eventBus: events.EventBus;

  // SQS Queues
  public readonly backgroundJobsQueue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  // ECS Fargate
  public readonly ecsCluster: ecs.Cluster;
  public readonly ecrRepository: ecr.Repository;
  public readonly ecsTaskDefinition: ecs.FargateTaskDefinition;
  public readonly ecsTaskRole: iam.Role;
  public readonly ecsExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props: CodeFlowInfrastructureStackProps) {
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
          destination: ec2.FlowLogDestination.toCloudWatchLogs(
            new logs.LogGroup(this, 'VPCFlowLogGroup', {
              logGroupName: `/aws/vpc/codeflow-${environmentName}`,
              retention: logs.RetentionDays.ONE_WEEK,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            })
          ),
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
    this.openSearchSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(443),
      'Allow Lambda to access OpenSearch'
    );

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
      REGION: this.region,  // Changed from AWS_REGION to REGION (AWS_REGION is reserved)
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
      image: ecs.ContainerImage.fromEcrRepository(
        this.ecrRepository,
        'latest' // Will be updated during deployment
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
    genAIDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // LLM Cache Performance Widget
    genAIDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // Token Usage & Cost Widget
    genAIDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // Bedrock Invocation Count Widget
    genAIDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    cdk.Tags.of(genAIDashboard).add('Name', `CodeFlow-GenAI-Performance-${environmentName}`);
    cdk.Tags.of(genAIDashboard).add('Environment', environmentName);

    // ========================================
    // 2. API Health Dashboard
    // ========================================

    const apiHealthDashboard = new cloudwatch.Dashboard(this, 'APIHealthDashboard', {
      dashboardName: `CodeFlow-API-Health-${environmentName}`,
    });

    // API Request Rate Widget
    apiHealthDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // API Error Rate Widget
    apiHealthDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // API Latency Widget (P50, P95, P99)
    apiHealthDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // Lambda Concurrent Executions Widget
    apiHealthDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // DynamoDB Throttling Events Widget
    apiHealthDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    cdk.Tags.of(apiHealthDashboard).add('Name', `CodeFlow-API-Health-${environmentName}`);
    cdk.Tags.of(apiHealthDashboard).add('Environment', environmentName);

    // ========================================
    // 3. User Engagement Dashboard
    // ========================================

    const userEngagementDashboard = new cloudwatch.Dashboard(this, 'UserEngagementDashboard', {
      dashboardName: `CodeFlow-User-Engagement-${environmentName}`,
    });

    // Daily Active Users Widget
    userEngagementDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // Problems Solved Widget
    userEngagementDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // Learning Paths Generated Widget
    userEngagementDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

    // Chat Mentor Conversations Widget
    userEngagementDashboard.addWidgets(
      new cloudwatch.GraphWidget({
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
      })
    );

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
    // Scraping API endpoints
    // ========================================

    const scrapingIntegration = new apigateway.LambdaIntegration(this.scrapingFunction, {
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

    // Create /scraping resource
    const scrapingResource = this.restApi.root.addResource('scraping');

    // POST /scraping/fetch-profile
    const fetchProfileResource = scrapingResource.addResource('fetch-profile');
    fetchProfileResource.addMethod('POST', scrapingIntegration, {
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
