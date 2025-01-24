#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { LinearClient, IssuePayload, Team } from '@linear/sdk';
import { LinearAuth } from './auth.js';
import { LinearGraphQLClient } from './graphql/client.js';

class LinearServer {
  private server: Server;
  private auth: LinearAuth;
  private graphqlClient?: LinearGraphQLClient;

  constructor() {
    this.server = new Server(
      {
        name: 'linear-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.auth = new LinearAuth();
    
    // Initialize with PAT if available
    const accessToken = process.env.LINEAR_ACCESS_TOKEN;
    if (accessToken) {
      this.auth.initialize({
        type: 'pat',
        accessToken
      });
      this.graphqlClient = new LinearGraphQLClient(this.auth.getClient());
    }
    
    this.setupToolHandlers();
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'linear_auth',
          description: 'Initialize OAuth flow with Linear',
          inputSchema: {
            type: 'object',
            properties: {
              clientId: {
                type: 'string',
                description: 'Linear OAuth client ID',
              },
              clientSecret: {
                type: 'string',
                description: 'Linear OAuth client secret',
              },
              redirectUri: {
                type: 'string',
                description: 'OAuth redirect URI',
              },
            },
            required: ['clientId', 'clientSecret', 'redirectUri'],
          },
        },
        {
          name: 'linear_auth_callback',
          description: 'Handle OAuth callback',
          inputSchema: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                description: 'OAuth authorization code',
              },
            },
            required: ['code'],
          },
        },
        {
          name: 'linear_create_issue',
          description: 'Create a new issue in Linear',
          inputSchema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Issue title',
              },
              description: {
                type: 'string',
                description: 'Issue description',
              },
              teamId: {
                type: 'string',
                description: 'Team ID',
              },
              assigneeId: {
                type: 'string',
                description: 'Assignee user ID',
                optional: true,
              },
              priority: {
                type: 'number',
                description: 'Issue priority (0-4)',
                optional: true,
              },
              createAsUser: {
                type: 'string',
                description: 'Name to display for the created issue',
                optional: true,
              },
              displayIconUrl: {
                type: 'string',
                description: 'URL of the avatar to display',
                optional: true,
              },
            },
            required: ['title', 'description', 'teamId'],
          },
        },
        {
          name: 'linear_create_project_with_issues',
          description: 'Create a new project with associated issues',
          inputSchema: {
            type: 'object',
            properties: {
              project: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    description: 'Project name',
                  },
                  description: {
                    type: 'string',
                    description: 'Project description',
                  },
                  teamIds: {
                    type: 'array',
                    items: {
                      type: 'string',
                    },
                    description: 'Team IDs',
                  },
                },
                required: ['name', 'teamIds'],
              },
              issues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: {
                      type: 'string',
                      description: 'Issue title',
                    },
                    description: {
                      type: 'string',
                      description: 'Issue description',
                    },
                    teamId: {
                      type: 'string',
                      description: 'Team ID',
                    },
                  },
                  required: ['title', 'description', 'teamId'],
                },
                description: 'List of issues to create',
              },
            },
            required: ['project', 'issues'],
          },
        },
        {
          name: 'linear_bulk_update_issues',
          description: 'Update multiple issues at once',
          inputSchema: {
            type: 'object',
            properties: {
              issueIds: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'List of issue IDs to update',
              },
              update: {
                type: 'object',
                properties: {
                  stateId: {
                    type: 'string',
                    description: 'New state ID',
                    optional: true,
                  },
                  assigneeId: {
                    type: 'string',
                    description: 'New assignee ID',
                    optional: true,
                  },
                  priority: {
                    type: 'number',
                    description: 'New priority (0-4)',
                    optional: true,
                  },
                },
              },
            },
            required: ['issueIds', 'update'],
          },
        },
        {
          name: 'linear_search_issues',
          description: 'Search for issues with filtering and pagination',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query string',
                optional: true,
              },
              teamIds: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Filter by team IDs',
                optional: true,
              },
              assigneeIds: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Filter by assignee IDs',
                optional: true,
              },
              states: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Filter by state names',
                optional: true,
              },
              priority: {
                type: 'number',
                description: 'Filter by priority (0-4)',
                optional: true,
              },
              first: {
                type: 'number',
                description: 'Number of issues to return (default: 50)',
                optional: true,
              },
              after: {
                type: 'string',
                description: 'Cursor for pagination',
                optional: true,
              },
              orderBy: {
                type: 'string',
                description: 'Field to order by (default: updatedAt)',
                optional: true,
              },
            },
          },
        },
        {
          name: 'linear_get_teams',
          description: 'Get all teams with their states and labels',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'linear_get_user',
          description: 'Get current user information',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'linear_delete_issue',
          description: 'Delete an issue',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Issue identifier (e.g., ENG-123)',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'linear_delete_issues',
          description: 'Delete multiple issues',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'List of issue identifiers to delete',
              },
            },
            required: ['ids'],
          },
        },
        {
          name: 'linear_get_project',
          description: 'Get project information',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'Project identifier',
              },
            },
            required: ['id'],
          },
        },
        {
          name: 'linear_search_projects',
          description: 'Search for projects by name',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Project name to search for (exact match)',
              },
            },
            required: ['name'],
          },
        },
        {
          name: 'linear_create_issues',
          description: 'Create multiple issues at once',
          inputSchema: {
            type: 'object',
            properties: {
              issues: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: {
                      type: 'string',
                      description: 'Issue title',
                    },
                    description: {
                      type: 'string',
                      description: 'Issue description',
                    },
                    teamId: {
                      type: 'string',
                      description: 'Team ID',
                    },
                    projectId: {
                      type: 'string',
                      description: 'Project ID',
                      optional: true,
                    },
                    labelIds: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                      description: 'Label IDs to apply',
                      optional: true,
                    }
                  },
                  required: ['title', 'description', 'teamId'],
                },
                description: 'List of issues to create',
              },
            },
            required: ['issues'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      switch (request.params.name) {
        case 'linear_auth':
          return this.handleAuth(request.params.arguments);
        case 'linear_auth_callback':
          return this.handleAuthCallback(request.params.arguments);
        case 'linear_create_issue':
          return this.handleCreateIssue(request.params.arguments);
        case 'linear_create_project_with_issues':
          return this.handleCreateProjectWithIssues(request.params.arguments);
        case 'linear_bulk_update_issues':
          return this.handleBulkUpdateIssues(request.params.arguments);
        case 'linear_search_issues':
          return this.handleSearchIssues(request.params.arguments);
        case 'linear_get_teams':
          return this.handleGetTeams(request.params.arguments);
        case 'linear_get_user':
          return this.handleGetUser(request.params.arguments);
        case 'linear_delete_issue':
          return this.handleDeleteIssue(request.params.arguments);
        case 'linear_delete_issues':
          return this.handleDeleteIssues(request.params.arguments);
        case 'linear_get_project':
          return this.handleGetProject(request.params.arguments);
        case 'linear_search_projects':
          return this.handleSearchProjects(request.params.arguments);
        case 'linear_create_issues':
          return this.handleCreateIssues(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  private async handleAuth(args: any): Promise<any> {
    if (!args.clientId || !args.clientSecret || !args.redirectUri) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameters: clientId, clientSecret, redirectUri'
      );
    }

    try {
      this.auth.initialize({
        type: 'oauth',
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        redirectUri: args.redirectUri,
      });

      const authUrl = this.auth.getAuthorizationUrl();

      return {
        content: [
          {
            type: 'text',
            text: `Please visit the following URL to authorize the application:\n${authUrl}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Authentication initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleAuthCallback(args: any): Promise<any> {
    if (!args.code) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: code'
      );
    }

    try {
      await this.auth.handleCallback(args.code);
      const client = this.auth.getClient();
      this.graphqlClient = new LinearGraphQLClient(client);

      return {
        content: [
          {
            type: 'text',
            text: 'Successfully authenticated with Linear',
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Authentication callback failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleCreateIssue(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.title || !args.description || !args.teamId) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameters: title, description, teamId'
      );
    }

    try {
      const result = await this.graphqlClient.createIssue({
        title: args.title,
        description: args.description,
        teamId: args.teamId,
        assigneeId: args.assigneeId,
        priority: args.priority,
        projectId: args.projectId
      });

      if (!result.issueCreate.success || !result.issueCreate.issue) {
        throw new Error('Failed to create issue');
      }

      const issue = result.issueCreate.issue;

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created issue\n` +
                  `Issue: ${issue.identifier}\n` +
                  `Title: ${issue.title}\n` +
                  `URL: ${issue.url}\n` +
                  `Project: ${issue.project ? issue.project.name : 'None'}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create issue: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleCreateProjectWithIssues(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.project || !args.issues || !Array.isArray(args.issues)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameters: project, issues'
      );
    }

    try {
      const result = await this.graphqlClient.createProjectWithIssues(
        args.project,
        args.issues
      );

      if (!result.projectCreate.success) {
        throw new Error('Failed to create project');
      }

      const { project } = result.projectCreate;
      const issuesCreated = result.issueCreate.issues.length;

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created project with issues\n` +
                  `Project: ${project.name}\n` +
                  `URL: ${project.url}\n` +
                  `Issues created: ${issuesCreated}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create project with issues: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleBulkUpdateIssues(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.issueIds || !Array.isArray(args.issueIds) || !args.update) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameters: issueIds, update'
      );
    }

    try {
      const result = await this.graphqlClient.updateIssues(
        args.issueIds,
        args.update
      );

      if (!result.issueUpdate.success) {
        throw new Error('Failed to update issues');
      }

      const updatedCount = result.issueUpdate.issues.length;

      return {
        content: [
          {
            type: 'text',
            text: `Successfully updated ${updatedCount} issues`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update issues: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchIssues(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    try {
      const filter: Record<string, any> = {};
      
      if (args.query) {
        filter.search = args.query;
      }
      if (args.teamIds) {
        filter.team = { id: { in: args.teamIds } };
      }
      if (args.assigneeIds) {
        filter.assignee = { id: { in: args.assigneeIds } };
      }
      if (args.states) {
        filter.state = { name: { in: args.states } };
      }
      if (typeof args.priority === 'number') {
        filter.priority = { eq: args.priority };
      }

      const result = await this.graphqlClient.searchIssues(
        filter,
        args.first || 50,
        args.after,
        args.orderBy || 'updatedAt'
      );

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search issues: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetTeams(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    try {
      const result = await this.graphqlClient.getTeams();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get teams: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetUser(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    try {
      const result = await this.graphqlClient.getCurrentUser();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get user info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleGetProject(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.id) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: id'
      );
    }

    try {
      const result = await this.graphqlClient.getProject(args.id);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get project info: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleDeleteIssues(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.ids || !Array.isArray(args.ids)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: ids'
      );
    }

    try {
      const result = await this.graphqlClient.deleteIssues(args.ids);

      if (!result.issueDelete.success) {
        throw new Error('Failed to delete issues');
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully deleted ${args.ids.length} issues: ${args.ids.join(', ')}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete issues: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleCreateIssues(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.issues || !Array.isArray(args.issues)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: issues array'
      );
    }

    try {
      const result = await this.graphqlClient.createIssues(args.issues);

      if (!result.issueCreate.success) {
        throw new Error('Failed to create issues');
      }

      const createdIssues = result.issueCreate.issues;

      return {
        content: [
          {
            type: 'text',
            text: `Successfully created ${createdIssues.length} issues:\n` +
                  createdIssues.map(issue => 
                    `- ${issue.identifier}: ${issue.title}\n  URL: ${issue.url}`
                  ).join('\n'),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create issues: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSearchProjects(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.name) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: name'
      );
    }

    try {
      const result = await this.graphqlClient.searchProjects({
        name: { eq: args.name }
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to search projects: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleDeleteIssue(args: any): Promise<any> {
    if (!this.auth.isAuthenticated() || !this.graphqlClient) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Not authenticated. Call linear_auth first.'
      );
    }

    if (this.auth.needsTokenRefresh()) {
      await this.auth.refreshAccessToken();
    }

    if (!args.id) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Missing required parameter: id'
      );
    }

    try {
      const result = await this.graphqlClient.deleteIssue(args.id);

      if (!result.issueDelete.success) {
        throw new Error('Failed to delete issue');
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully deleted issue ${args.id}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete issue: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Linear MCP server running on stdio');
  }
}

const server = new LinearServer();
server.run().catch(console.error);
