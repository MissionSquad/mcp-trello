#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TrelloClient } from './trello-client.js';
import { TrelloHealthEndpoints, HealthEndpointSchemas } from './health/health-endpoints.js';

class TrelloServer {
  private server: McpServer;
  private trelloClient: TrelloClient;
  private healthEndpoints: TrelloHealthEndpoints;

  constructor() {
    // Don't require env vars at startup - they can come from tool arguments
    const apiKey = process.env.TRELLO_API_KEY || '';
    const token = process.env.TRELLO_TOKEN || '';
    const defaultBoardId = process.env.TRELLO_BOARD_ID;

    this.trelloClient = new TrelloClient({
      apiKey, // Can be empty, will be provided per-request
      token, // Can be empty, will be provided per-request
      defaultBoardId,
      boardId: defaultBoardId,
    });

    this.healthEndpoints = new TrelloHealthEndpoints(this.trelloClient);

    this.server = new McpServer({
      name: 'trello-server',
      version: '1.0.0',
    });

    this.setupTools();
    this.setupHealthEndpoints();

    // Error handling
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Extract and validate Trello credentials from tool arguments with fallback to environment
   * @param args Tool call arguments that may contain trelloApiKey and trelloToken
   * @returns Validated credentials object
   * @throws Error if credentials are not found in either source
   */
  private getCredentials(args: any): { apiKey: string; token: string } {
    // Check arguments first (Mission Squad injects secrets here)
    let apiKey = args.trelloApiKey;
    let token = args.trelloToken;

    // Fall back to environment variables if not in arguments
    if (!apiKey) {
      apiKey = process.env.TRELLO_API_KEY;
    }
    if (!token) {
      token = process.env.TRELLO_TOKEN;
    }

    // Validate we have both credentials
    if (!apiKey || !token) {
      throw new Error(
        'Trello credentials required. Configure secrets "trelloApiKey" and "trelloToken" in Mission Squad, ' +
          'or set TRELLO_API_KEY and TRELLO_TOKEN environment variables.'
      );
    }

    return { apiKey, token };
  }

  private handleError(error: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        },
      ],
      isError: true,
    };
  }

  private setupTools() {
    // Get cards from a specific list
    this.server.registerTool(
      'get_cards_by_list_id',
      {
        title: 'Get Cards by List ID',
        description: 'Fetch cards from a specific Trello list on a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          listId: z.string().describe('ID of the Trello list'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const cards = await this.trelloClient.getCardsByList(
            apiKey,
            token,
            args.boardId,
            args.listId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(cards, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Get all lists from a board
    this.server.registerTool(
      'get_lists',
      {
        title: 'Get Lists',
        description: 'Retrieve all lists from the specified board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const lists = await this.trelloClient.getLists(apiKey, token, args.boardId);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(lists, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Get recent activity
    this.server.registerTool(
      'get_recent_activity',
      {
        title: 'Get Recent Activity',
        description: 'Fetch recent activity on the Trello board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          limit: z
            .number()
            .optional()
            .default(10)
            .describe('Number of activities to fetch (default: 10)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const activity = await this.trelloClient.getRecentActivity(
            apiKey,
            token,
            args.boardId,
            args.limit
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(activity, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Add a new card to a list
    this.server.registerTool(
      'add_card_to_list',
      {
        title: 'Add Card to List',
        description: 'Add a new card to a specified list on a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          listId: z.string().describe('ID of the list to add the card to'),
          name: z.string().describe('Name of the card'),
          description: z.string().optional().describe('Description of the card'),
          dueDate: z.string().optional().describe('Due date for the card (ISO 8601 format)'),
          start: z
            .string()
            .optional()
            .describe('Start date for the card (YYYY-MM-DD format, date only)'),
          labels: z
            .array(z.string())
            .optional()
            .describe('Array of label IDs to apply to the card'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.addCard(apiKey, token, args.boardId, args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Update card details
    this.server.registerTool(
      'update_card_details',
      {
        title: 'Update Card Details',
        description: "Update an existing card's details on a specific board",
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          cardId: z.string().describe('ID of the card to update'),
          name: z.string().optional().describe('New name for the card'),
          description: z.string().optional().describe('New description for the card'),
          dueDate: z.string().optional().describe('New due date for the card (ISO 8601 format)'),
          start: z
            .string()
            .optional()
            .describe('New start date for the card (YYYY-MM-DD format, date only)'),
          dueComplete: z
            .boolean()
            .optional()
            .describe('Mark the due date as complete (true) or incomplete (false)'),
          labels: z.array(z.string()).optional().describe('New array of label IDs for the card'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.updateCard(apiKey, token, args.boardId, args);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Archive a card
    this.server.registerTool(
      'archive_card',
      {
        title: 'Archive Card',
        description: 'Send a card to the archive on a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          cardId: z.string().describe('ID of the card to archive'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.archiveCard(
            apiKey,
            token,
            args.boardId,
            args.cardId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Move a card
    this.server.registerTool(
      'move_card',
      {
        title: 'Move Card',
        description: 'Move a card to a different list, potentially on a different board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe(
              'ID of the target Trello board (where the listId resides, uses default if not provided)'
            ),
          cardId: z.string().describe('ID of the card to move'),
          listId: z.string().describe('ID of the target list'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.moveCard(
            apiKey,
            token,
            args.boardId,
            args.cardId,
            args.listId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Add a new list to a board
    this.server.registerTool(
      'add_list_to_board',
      {
        title: 'Add List to Board',
        description: 'Add a new list to the specified board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          name: z.string().describe('Name of the new list'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const list = await this.trelloClient.addList(apiKey, token, args.boardId, args.name);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Archive a list
    this.server.registerTool(
      'archive_list',
      {
        title: 'Archive List',
        description: 'Send a list to the archive on a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          listId: z.string().describe('ID of the list to archive'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const list = await this.trelloClient.archiveList(
            apiKey,
            token,
            args.boardId,
            args.listId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Get cards assigned to current user
    this.server.registerTool(
      'get_my_cards',
      {
        title: 'Get My Cards',
        description: 'Fetch all cards assigned to the current user',
        inputSchema: {},
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const cards = await this.trelloClient.getMyCards(apiKey, token);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(cards, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Attach image to card (kept for backward compatibility)
    this.server.registerTool(
      'attach_image_to_card',
      {
        title: 'Attach Image to Card',
        description: 'Attach an image to a card from a URL on a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe(
              'ID of the Trello board where the card exists (uses default if not provided)'
            ),
          cardId: z.string().describe('ID of the card to attach the image to'),
          imageUrl: z.string().describe('URL of the image to attach'),
          name: z
            .string()
            .optional()
            .default('Image Attachment')
            .describe('Optional name for the attachment (defaults to "Image Attachment")'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const attachment = await this.trelloClient.attachImageToCard(
            apiKey,
            token,
            args.boardId,
            args.cardId,
            args.imageUrl,
            args.name
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(attachment, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Attach file to card (generic file attachment)
    this.server.registerTool(
      'attach_file_to_card',
      {
        title: 'Attach File to Card',
        description: 'Attach any file to a card from a URL on a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe(
              'ID of the Trello board where the card exists (uses default if not provided)'
            ),
          cardId: z.string().describe('ID of the card to attach the file to'),
          fileUrl: z.string().describe('URL of the file to attach'),
          name: z
            .string()
            .optional()
            .default('File Attachment')
            .describe('Optional name for the attachment (defaults to "File Attachment")'),
          mimeType: z
            .string()
            .optional()
            .describe(
              'Optional MIME type of the file (e.g., "application/pdf", "text/plain", "video/mp4")'
            ),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const attachment = await this.trelloClient.attachFileToCard(
            apiKey,
            token,
            args.boardId,
            args.cardId,
            args.fileUrl,
            args.name,
            args.mimeType
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(attachment, null, 2) }],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    // Attach image data to card (for base64/data URL uploads)
    this.server.registerTool(
      'attach_image_data_to_card',
      {
        title: 'Attach Image Data to Card',
        description:
          'Attach an image to a card from base64 data or data URL (for screenshot uploads)',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe(
              'ID of the Trello board where the card exists (uses default if not provided)'
            ),
          cardId: z.string().describe('ID of the card to attach the image to'),
          imageData: z
            .string()
            .describe('Base64 encoded image data or data URL (e.g., data:image/png;base64,...)'),
          name: z.string().optional().describe('Optional name for the attachment'),
          mimeType: z
            .string()
            .optional()
            .default('image/png')
            .describe('Optional MIME type (default: image/png)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const attachment = await this.trelloClient.attachImageDataToCard(
            apiKey,
            token,
            args.boardId,
            args.cardId,
            args.imageData,
            args.name,
            args.mimeType
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(attachment, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // List all boards
    this.server.registerTool(
      'list_boards',
      {
        title: 'List Boards',
        description: 'List all boards the user has access to',
        inputSchema: {},
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const boards = await this.trelloClient.listBoards(apiKey, token);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(boards, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Set active board
    this.server.registerTool(
      'set_active_board',
      {
        title: 'Set Active Board',
        description: 'Set the active board for future operations',
        inputSchema: {
          boardId: z.string().describe('ID of the board to set as active'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const board = await this.trelloClient.setActiveBoard(apiKey, token, args.boardId);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Successfully set active board to "${board.name}" (${board.id})`,
              },
            ],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // List workspaces
    this.server.registerTool(
      'list_workspaces',
      {
        title: 'List Workspaces',
        description: 'List all workspaces the user has access to',
        inputSchema: {},
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const workspaces = await this.trelloClient.listWorkspaces(apiKey, token);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(workspaces, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Create a new board
    this.server.registerTool(
      'create_board',
      {
        title: 'Create Board',
        description: 'Create a new Trello board optionally within a workspace',
        inputSchema: {
          name: z.string().describe('Name of the board'),
          desc: z.string().optional().describe('Description of the board'),
          idOrganization: z
            .string()
            .min(1)
            .optional()
            .describe('Workspace ID to create the board in (uses active if not provided)'),
          defaultLabels: z
            .boolean()
            .optional()
            .default(true)
            .describe('Create default labels (true by default)'),
          defaultLists: z
            .boolean()
            .optional()
            .default(true)
            .describe('Create default lists (true by default)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const board = await this.trelloClient.createBoard(apiKey, token, {
            name: args.name,
            desc: args.desc,
            idOrganization: args.idOrganization,
            defaultLabels: args.defaultLabels,
            defaultLists: args.defaultLists,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(board, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Set active workspace
    this.server.registerTool(
      'set_active_workspace',
      {
        title: 'Set Active Workspace',
        description: 'Set the active workspace for future operations',
        inputSchema: {
          workspaceId: z.string().describe('ID of the workspace to set as active'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const workspace = await this.trelloClient.setActiveWorkspace(
            apiKey,
            token,
            args.workspaceId
          );
          return {
            content: [
              {
                type: 'text' as const,
                text: `Successfully set active workspace to "${workspace.displayName}" (${workspace.id})`,
              },
            ],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // List boards in workspace
    this.server.registerTool(
      'list_boards_in_workspace',
      {
        title: 'List Boards in Workspace',
        description: 'List all boards in a specific workspace',
        inputSchema: {
          workspaceId: z.string().describe('ID of the workspace to list boards from'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const boards = await this.trelloClient.listBoardsInWorkspace(
            apiKey,
            token,
            args.workspaceId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(boards, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Get active board info
    this.server.registerTool(
      'get_active_board_info',
      {
        title: 'Get Active Board Info',
        description: 'Get information about the currently active board',
        inputSchema: {},
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const boardId = this.trelloClient.activeBoardId;
          if (!boardId) {
            return {
              content: [{ type: 'text' as const, text: 'No active board set' }],
              isError: true,
            };
          }
          const board = await this.trelloClient.getBoardById(apiKey, token, boardId);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    ...board,
                    isActive: true,
                    activeWorkspaceId: this.trelloClient.activeWorkspaceId || 'Not set',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Get card details
    this.server.registerTool(
      'get_card',
      {
        title: 'Get Card',
        description: 'Get detailed information about a specific Trello card',
        inputSchema: {
          cardId: z.string().describe('ID of the card to fetch'),
          includeMarkdown: z
            .boolean()
            .optional()
            .default(false)
            .describe('Whether to return card description in markdown format (default: false)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.getCard(
            apiKey,
            token,
            args.cardId,
            args.includeMarkdown
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Add a comment to a card
    this.server.registerTool(
      'add_comment',
      {
        title: 'Add Comment to Card',
        description: 'Add the given text as a new comment to the given card',
        inputSchema: {
          cardId: z.string().describe('ID of the card to comment on'),
          text: z.string().describe('The text of the comment to add'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const comment = await this.trelloClient.addCommentToCard(
            apiKey,
            token,
            args.cardId,
            args.text
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(comment, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Update a comment to a card
    this.server.registerTool(
      'update_comment',
      {
        title: 'Update Comment on Card',
        description: 'Update the given comment with the new text',
        inputSchema: {
          commentId: z.string().describe('ID of the comment to change'),
          text: z.string().describe('The new text of the comment'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const success = await this.trelloClient.updateCommentOnCard(
            apiKey,
            token,
            args.commentId,
            args.text
          );
          return {
            content: [{ type: 'text' as const, text: success ? 'success' : 'failure' }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Delete a comment from a card
    this.server.registerTool(
      'delete_comment',
      {
        title: 'Delete Comment from Card',
        description: 'Delete a comment from a Trello card',
        inputSchema: {
          commentId: z.string().describe('ID of the comment to delete'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const success = await this.trelloClient.deleteCommentFromCard(
            apiKey,
            token,
            args.commentId
          );
          return {
            content: [{ type: 'text' as const, text: success ? 'success' : 'failure' }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Get comments from a card
    this.server.registerTool(
      'get_card_comments',
      {
        title: 'Get Card Comments',
        description: 'Retrieve all comments from a specific Trello card',
        inputSchema: {
          cardId: z.string().describe('ID of the card to get comments from'),
          limit: z
            .number()
            .optional()
            .default(100)
            .describe('Maximum number of comments to retrieve (default: 100)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const comments = await this.trelloClient.getCardComments(
            apiKey,
            token,
            args.cardId,
            args.limit
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(comments, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Checklist tools
    this.server.registerTool(
      'create_checklist',
      {
        title: 'Create Checklist',
        description: 'Create a new checklist',
        inputSchema: {
          name: z.string().describe('Name of the checklist to create'),
          cardId: z.string().describe('ID of the Trello card'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const items = await this.trelloClient.createChecklist(
            apiKey,
            token,
            args.name,
            args.cardId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Checklist tools
    this.server.registerTool(
      'get_checklist_items',
      {
        title: 'Get Checklist Items',
        description: 'Get all items from a checklist by name',
        inputSchema: {
          name: z.string().describe('Name of the checklist to retrieve items from'),
          cardId: z
            .string()
            .optional()
            .describe(
              'ID of the card to scope checklist search to (recommended to avoid ambiguity)'
            ),
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async ({ name, cardId, boardId }) => {
        try {
          const items = await this.trelloClient.getChecklistItems(name, cardId, boardId);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'add_checklist_item',
      {
        title: 'Add Checklist Item',
        description: 'Add a new item to a checklist',
        inputSchema: {
          text: z.string().describe('Text content of the checklist item'),
          checkListName: z.string().describe('Name of the checklist to add the item to'),
          cardId: z
            .string()
            .optional()
            .describe(
              'ID of the card to scope checklist search to (recommended to avoid ambiguity)'
            ),
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async ({ text, checkListName, cardId, boardId }) => {
        try {
          const item = await this.trelloClient.addChecklistItem(
            text,
            checkListName,
            cardId,
            boardId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'find_checklist_items_by_description',
      {
        title: 'Find Checklist Items by Description',
        description: 'Search for checklist items containing specific text in their description',
        inputSchema: {
          description: z.string().describe('Text to search for in checklist item descriptions'),
          cardId: z
            .string()
            .optional()
            .describe(
              'ID of the card to scope checklist search to (recommended to avoid ambiguity)'
            ),
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async ({ description, cardId, boardId }) => {
        try {
          const items = await this.trelloClient.findChecklistItemsByDescription(
            description,
            cardId,
            boardId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'get_acceptance_criteria',
      {
        title: 'Get Acceptance Criteria',
        description: 'Get all items from the "Acceptance Criteria" checklist',
        inputSchema: {
          cardId: z
            .string()
            .optional()
            .describe(
              'ID of the card to scope checklist search to (recommended to avoid ambiguity)'
            ),
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async ({ cardId, boardId }) => {
        try {
          const items = await this.trelloClient.getAcceptanceCriteria(cardId, boardId);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(items, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'get_checklist_by_name',
      {
        title: 'Get Checklist by Name',
        description: 'Get a complete checklist with all its items and completion percentage',
        inputSchema: {
          name: z.string().describe('Name of the checklist to retrieve'),
          cardId: z
            .string()
            .optional()
            .describe(
              'ID of the card to scope checklist search to (recommended to avoid ambiguity)'
            ),
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async ({ name, cardId, boardId }) => {
        try {
          const checklist = await this.trelloClient.getChecklistByName(name, cardId, boardId);
          if (!checklist) {
            return {
              content: [{ type: 'text' as const, text: `Checklist "${name}" not found` }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(checklist, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'update_checklist_item',
      {
        title: 'Update Checklist Item',
        description: 'Update a checklist item state (mark as complete or incomplete)',
        inputSchema: {
          cardId: z.string().describe('ID of the card containing the checklist item'),
          checkItemId: z.string().describe('ID of the checklist item to update'),
          state: z.enum(['complete', 'incomplete']).describe('New state for the checklist item'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const item = await this.trelloClient.updateChecklistItem(
            apiKey,
            token,
            args.cardId,
            args.checkItemId,
            args.state
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Member management tools
    this.server.registerTool(
      'get_board_members',
      {
        title: 'Get Board Members',
        description: 'Get all members of a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const members = await this.trelloClient.getBoardMembers(apiKey, token, args.boardId);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(members, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'assign_member_to_card',
      {
        title: 'Assign Member to Card',
        description: 'Assign a member to a specific card',
        inputSchema: {
          cardId: z.string().describe('ID of the card to assign the member to'),
          memberId: z.string().describe('ID of the member to assign to the card'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.assignMemberToCard(
            apiKey,
            token,
            args.cardId,
            args.memberId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'remove_member_from_card',
      {
        title: 'Remove Member from Card',
        description: 'Remove a member from a specific card',
        inputSchema: {
          cardId: z.string().describe('ID of the card to remove the member from'),
          memberId: z.string().describe('ID of the member to remove from the card'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const card = await this.trelloClient.removeMemberFromCard(
            apiKey,
            token,
            args.cardId,
            args.memberId
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Label management tools
    this.server.registerTool(
      'get_board_labels',
      {
        title: 'Get Board Labels',
        description: 'Get all labels of a specific board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const labels = await this.trelloClient.getBoardLabels(apiKey, token, args.boardId);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(labels, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'create_label',
      {
        title: 'Create Label',
        description: 'Create a new label on a board',
        inputSchema: {
          boardId: z
            .string()
            .optional()
            .describe('ID of the Trello board (uses default if not provided)'),
          name: z.string().describe('Name of the label'),
          color: z
            .string()
            .optional()
            .describe(
              'Color of the label (e.g., "red", "blue", "green", "yellow", "orange", "purple", "pink", "sky", "lime", "black", "null")'
            ),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const label = await this.trelloClient.createLabel(
            apiKey,
            token,
            args.boardId,
            args.name,
            args.color
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(label, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'update_label',
      {
        title: 'Update Label',
        description: 'Update an existing label',
        inputSchema: {
          labelId: z.string().describe('ID of the label to update'),
          name: z.string().optional().describe('New name for the label'),
          color: z.string().optional().describe('New color for the label'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const label = await this.trelloClient.updateLabel(
            apiKey,
            token,
            args.labelId,
            args.name,
            args.color
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(label, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    this.server.registerTool(
      'delete_label',
      {
        title: 'Delete Label',
        description: 'Delete a label from a board',
        inputSchema: {
          labelId: z.string().describe('ID of the label to delete'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          await this.trelloClient.deleteLabel(apiKey, token, args.labelId);
          return {
            content: [{ type: 'text' as const, text: 'Label deleted successfully' }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Card history tool
    this.server.registerTool(
      'get_card_history',
      {
        title: 'Get Card History',
        description: 'Get the history/actions of a specific card',
        inputSchema: {
          cardId: z.string().describe('ID of the card to get history for'),
          filter: z
            .string()
            .optional()
            .describe(
              'Optional: Filter actions by type (e.g., "all", "updateCard:idList", "addAttachmentToCard", "commentCard", "updateCard:name", "updateCard:desc", "updateCard:due", "addMemberToCard", "removeMemberFromCard", "addLabelToCard", "removeLabelFromCard")'
            ),
          limit: z
            .number()
            .optional()
            .describe('Optional: Number of actions to fetch (default: all)'),
        },
      },
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          const history = await this.trelloClient.getCardHistory(
            apiKey,
            token,
            args.cardId,
            args.filter,
            args.limit
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(history, null, 2) }],
          };
        } catch (error) {
          return this.handleError(error);
        }
      }
    );
  }

  private setupHealthEndpoints() {
    // Basic health check endpoint
    this.server.registerTool('get_health', HealthEndpointSchemas.basicHealth, async args => {
      try {
        const { apiKey, token } = this.getCredentials(args);
        return await this.healthEndpoints.getBasicHealth(apiKey, token);
      } catch (error) {
        return this.handleError(error);
      }
    });

    // Detailed health diagnostic endpoint
    this.server.registerTool(
      'get_health_detailed',
      HealthEndpointSchemas.detailedHealth,
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          return await this.healthEndpoints.getDetailedHealth(apiKey, token);
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Metadata consistency check endpoint
    this.server.registerTool(
      'get_health_metadata',
      HealthEndpointSchemas.metadataHealth,
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          return await this.healthEndpoints.getMetadataHealth(apiKey, token);
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // Performance metrics endpoint
    this.server.registerTool(
      'get_health_performance',
      HealthEndpointSchemas.performanceHealth,
      async args => {
        try {
          const { apiKey, token } = this.getCredentials(args);
          return await this.healthEndpoints.getPerformanceHealth(apiKey, token);
        } catch (error) {
          return this.handleError(error);
        }
      }
    );

    // System repair endpoint
    this.server.registerTool('perform_system_repair', HealthEndpointSchemas.repair, async args => {
      try {
        const { apiKey, token } = this.getCredentials(args);
        return await this.healthEndpoints.performRepair(apiKey, token);
      } catch (error) {
        return this.handleError(error);
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    // Load configuration before starting the server
    await this.trelloClient.loadConfig().catch(() => {
      // Continue with default config if loading fails
    });
    await this.server.connect(transport);
  }
}

const server = new TrelloServer();
server.run().catch(() => {
  // Silently handle errors to avoid interfering with MCP protocol
});
