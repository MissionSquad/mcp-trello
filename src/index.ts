#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TrelloClient } from './trello-client.js';
import { TrelloHealthEndpoints } from './health/health-endpoints.js';

// ============================================================================
// PUBLIC ZOD SCHEMAS (Exposed to LLM - NO SECRETS)
// ============================================================================

const GetCardsByListIdSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  listId: z.string().describe('ID of the Trello list'),
});

const GetListsSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const GetRecentActivitySchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  limit: z.number().optional().default(10).describe('Number of activities to fetch (default: 10)'),
});

const AddCardToListSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  listId: z.string().describe('ID of the list to add the card to'),
  name: z.string().describe('Name of the card'),
  description: z.string().optional().describe('Description of the card'),
  dueDate: z.string().optional().describe('Due date for the card (ISO 8601 format)'),
  start: z.string().optional().describe('Start date for the card (YYYY-MM-DD format, date only)'),
  labels: z.array(z.string()).optional().describe('Array of label IDs to apply to the card'),
});

const UpdateCardDetailsSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
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
});

const ArchiveCardSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  cardId: z.string().describe('ID of the card to archive'),
});

const MoveCardSchema = z.object({
  boardId: z
    .string()
    .optional()
    .describe(
      'ID of the target Trello board (where the listId resides, uses default if not provided)'
    ),
  cardId: z.string().describe('ID of the card to move'),
  listId: z.string().describe('ID of the target list'),
});

const AddListToBoardSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  name: z.string().describe('Name of the new list'),
});

const ArchiveListSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  listId: z.string().describe('ID of the list to archive'),
});

const GetMyCardsSchema = z.object({});

const AttachImageToCardSchema = z.object({
  boardId: z
    .string()
    .optional()
    .describe('ID of the Trello board where the card exists (uses default if not provided)'),
  cardId: z.string().describe('ID of the card to attach the image to'),
  imageUrl: z.string().describe('URL of the image to attach'),
  name: z
    .string()
    .optional()
    .default('Image Attachment')
    .describe('Optional name for the attachment (defaults to "Image Attachment")'),
});

const AttachFileToCardSchema = z.object({
  boardId: z
    .string()
    .optional()
    .describe('ID of the Trello board where the card exists (uses default if not provided)'),
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
});

const AttachImageDataToCardSchema = z.object({
  boardId: z
    .string()
    .optional()
    .describe('ID of the Trello board where the card exists (uses default if not provided)'),
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
});

const ListBoardsSchema = z.object({});

const SetActiveBoardSchema = z.object({
  boardId: z.string().describe('ID of the board to set as active'),
});

const ListWorkspacesSchema = z.object({});

const CreateBoardSchema = z.object({
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
});

const SetActiveWorkspaceSchema = z.object({
  workspaceId: z.string().describe('ID of the workspace to set as active'),
});

const ListBoardsInWorkspaceSchema = z.object({
  workspaceId: z.string().describe('ID of the workspace to list boards from'),
});

const GetActiveBoardInfoSchema = z.object({});

const GetCardSchema = z.object({
  cardId: z.string().describe('ID of the card to fetch'),
  includeMarkdown: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to return card description in markdown format (default: false)'),
});

const AddCommentSchema = z.object({
  cardId: z.string().describe('ID of the card to comment on'),
  text: z.string().describe('The text of the comment to add'),
});

const UpdateCommentSchema = z.object({
  commentId: z.string().describe('ID of the comment to change'),
  text: z.string().describe('The new text of the comment'),
});

const DeleteCommentSchema = z.object({
  commentId: z.string().describe('ID of the comment to delete'),
});

const GetCardCommentsSchema = z.object({
  cardId: z.string().describe('ID of the card to get comments from'),
  limit: z
    .number()
    .optional()
    .default(100)
    .describe('Maximum number of comments to retrieve (default: 100)'),
});

const CreateChecklistSchema = z.object({
  name: z.string().describe('Name of the checklist to create'),
  cardId: z.string().describe('ID of the Trello card'),
});

const GetChecklistItemsSchema = z.object({
  name: z.string().describe('Name of the checklist to retrieve items from'),
  cardId: z
    .string()
    .optional()
    .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const AddChecklistItemSchema = z.object({
  text: z.string().describe('Text content of the checklist item'),
  checkListName: z.string().describe('Name of the checklist to add the item to'),
  cardId: z
    .string()
    .optional()
    .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const FindChecklistItemsByDescriptionSchema = z.object({
  description: z.string().describe('Text to search for in checklist item descriptions'),
  cardId: z
    .string()
    .optional()
    .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const GetAcceptanceCriteriaSchema = z.object({
  cardId: z
    .string()
    .optional()
    .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const GetChecklistByNameSchema = z.object({
  name: z.string().describe('Name of the checklist to retrieve'),
  cardId: z
    .string()
    .optional()
    .describe('ID of the card to scope checklist search to (recommended to avoid ambiguity)'),
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const UpdateChecklistItemSchema = z.object({
  cardId: z.string().describe('ID of the card containing the checklist item'),
  checkItemId: z.string().describe('ID of the checklist item to update'),
  state: z.enum(['complete', 'incomplete']).describe('New state for the checklist item'),
});

const GetBoardMembersSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const AssignMemberToCardSchema = z.object({
  cardId: z.string().describe('ID of the card to assign the member to'),
  memberId: z.string().describe('ID of the member to assign to the card'),
});

const RemoveMemberFromCardSchema = z.object({
  cardId: z.string().describe('ID of the card to remove the member from'),
  memberId: z.string().describe('ID of the member to remove from the card'),
});

const GetBoardLabelsSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
});

const CreateLabelSchema = z.object({
  boardId: z.string().optional().describe('ID of the Trello board (uses default if not provided)'),
  name: z.string().describe('Name of the label'),
  color: z
    .string()
    .optional()
    .describe(
      'Color of the label (e.g., "red", "blue", "green", "yellow", "orange", "purple", "pink", "sky", "lime", "black", "null")'
    ),
});

const UpdateLabelSchema = z.object({
  labelId: z.string().describe('ID of the label to update'),
  name: z.string().optional().describe('New name for the label'),
  color: z.string().optional().describe('New color for the label'),
});

const DeleteLabelSchema = z.object({
  labelId: z.string().describe('ID of the label to delete'),
});

const GetCardHistorySchema = z.object({
  cardId: z.string().describe('ID of the card to get history for'),
  filter: z
    .string()
    .optional()
    .describe(
      'Optional: Filter actions by type (e.g., "all", "updateCard:idList", "addAttachmentToCard", "commentCard", "updateCard:name", "updateCard:desc", "updateCard:due", "addMemberToCard", "removeMemberFromCard", "addLabelToCard", "removeLabelFromCard")'
    ),
  limit: z.number().optional().describe('Optional: Number of actions to fetch (default: all)'),
});

const GetHealthSchema = z.object({});
const GetHealthDetailedSchema = z.object({});
const GetHealthMetadataSchema = z.object({});
const GetHealthPerformanceSchema = z.object({});
const PerformSystemRepairSchema = z.object({});

// ============================================================================
// INTERNAL ZOD SCHEMAS (Used for validation - INCLUDES SECRETS)
// ============================================================================

const _GetCardsByListIdSchema = GetCardsByListIdSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetListsSchema = GetListsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetRecentActivitySchema = GetRecentActivitySchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AddCardToListSchema = AddCardToListSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _UpdateCardDetailsSchema = UpdateCardDetailsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _ArchiveCardSchema = ArchiveCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _MoveCardSchema = MoveCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AddListToBoardSchema = AddListToBoardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _ArchiveListSchema = ArchiveListSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetMyCardsSchema = GetMyCardsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AttachImageToCardSchema = AttachImageToCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AttachFileToCardSchema = AttachFileToCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AttachImageDataToCardSchema = AttachImageDataToCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _ListBoardsSchema = ListBoardsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _SetActiveBoardSchema = SetActiveBoardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _ListWorkspacesSchema = ListWorkspacesSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _CreateBoardSchema = CreateBoardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _SetActiveWorkspaceSchema = SetActiveWorkspaceSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _ListBoardsInWorkspaceSchema = ListBoardsInWorkspaceSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetActiveBoardInfoSchema = GetActiveBoardInfoSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetCardSchema = GetCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AddCommentSchema = AddCommentSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _UpdateCommentSchema = UpdateCommentSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _DeleteCommentSchema = DeleteCommentSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetCardCommentsSchema = GetCardCommentsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _CreateChecklistSchema = CreateChecklistSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetChecklistItemsSchema = GetChecklistItemsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AddChecklistItemSchema = AddChecklistItemSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _FindChecklistItemsByDescriptionSchema = FindChecklistItemsByDescriptionSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetAcceptanceCriteriaSchema = GetAcceptanceCriteriaSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetChecklistByNameSchema = GetChecklistByNameSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _UpdateChecklistItemSchema = UpdateChecklistItemSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetBoardMembersSchema = GetBoardMembersSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _AssignMemberToCardSchema = AssignMemberToCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _RemoveMemberFromCardSchema = RemoveMemberFromCardSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetBoardLabelsSchema = GetBoardLabelsSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _CreateLabelSchema = CreateLabelSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _UpdateLabelSchema = UpdateLabelSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _DeleteLabelSchema = DeleteLabelSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetCardHistorySchema = GetCardHistorySchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetHealthSchema = GetHealthSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetHealthDetailedSchema = GetHealthDetailedSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetHealthMetadataSchema = GetHealthMetadataSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _GetHealthPerformanceSchema = GetHealthPerformanceSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

const _PerformSystemRepairSchema = PerformSystemRepairSchema.extend({
  trelloApiKey: z.string().describe('Trello API Key'),
  trelloToken: z.string().describe('Trello Token'),
});

// ============================================================================
// TRELLO SERVER CLASS
// ============================================================================

class TrelloServer {
  private mcpServer: McpServer;
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

    this.mcpServer = new McpServer(
      {
        name: 'trello-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupRequestHandlers();

    // Error handling
    process.on('SIGINT', async () => {
      await this.mcpServer.close();
      process.exit(0);
    });
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

  private setupRequestHandlers() {
    // Handler 1: List available tools (public schemas only)
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'get_cards_by_list_id',
            description: 'Fetch cards from a specific Trello list on a specific board',
            inputSchema: zodToJsonSchema(GetCardsByListIdSchema),
          },
          {
            name: 'get_lists',
            description: 'Retrieve all lists from the specified board',
            inputSchema: zodToJsonSchema(GetListsSchema),
          },
          {
            name: 'get_recent_activity',
            description: 'Fetch recent activity on the Trello board',
            inputSchema: zodToJsonSchema(GetRecentActivitySchema),
          },
          {
            name: 'add_card_to_list',
            description: 'Add a new card to a specified list on a specific board',
            inputSchema: zodToJsonSchema(AddCardToListSchema),
          },
          {
            name: 'update_card_details',
            description: "Update an existing card's details on a specific board",
            inputSchema: zodToJsonSchema(UpdateCardDetailsSchema),
          },
          {
            name: 'archive_card',
            description: 'Send a card to the archive on a specific board',
            inputSchema: zodToJsonSchema(ArchiveCardSchema),
          },
          {
            name: 'move_card',
            description: 'Move a card to a different list, potentially on a different board',
            inputSchema: zodToJsonSchema(MoveCardSchema),
          },
          {
            name: 'add_list_to_board',
            description: 'Add a new list to the specified board',
            inputSchema: zodToJsonSchema(AddListToBoardSchema),
          },
          {
            name: 'archive_list',
            description: 'Send a list to the archive on a specific board',
            inputSchema: zodToJsonSchema(ArchiveListSchema),
          },
          {
            name: 'get_my_cards',
            description: 'Fetch all cards assigned to the current user',
            inputSchema: zodToJsonSchema(GetMyCardsSchema),
          },
          {
            name: 'attach_image_to_card',
            description: 'Attach an image to a card from a URL on a specific board',
            inputSchema: zodToJsonSchema(AttachImageToCardSchema),
          },
          {
            name: 'attach_file_to_card',
            description: 'Attach any file to a card from a URL on a specific board',
            inputSchema: zodToJsonSchema(AttachFileToCardSchema),
          },
          {
            name: 'attach_image_data_to_card',
            description:
              'Attach an image to a card from base64 data or data URL (for screenshot uploads)',
            inputSchema: zodToJsonSchema(AttachImageDataToCardSchema),
          },
          {
            name: 'list_boards',
            description: 'List all boards the user has access to',
            inputSchema: zodToJsonSchema(ListBoardsSchema),
          },
          {
            name: 'set_active_board',
            description: 'Set the active board for future operations',
            inputSchema: zodToJsonSchema(SetActiveBoardSchema),
          },
          {
            name: 'list_workspaces',
            description: 'List all workspaces the user has access to',
            inputSchema: zodToJsonSchema(ListWorkspacesSchema),
          },
          {
            name: 'create_board',
            description: 'Create a new Trello board optionally within a workspace',
            inputSchema: zodToJsonSchema(CreateBoardSchema),
          },
          {
            name: 'set_active_workspace',
            description: 'Set the active workspace for future operations',
            inputSchema: zodToJsonSchema(SetActiveWorkspaceSchema),
          },
          {
            name: 'list_boards_in_workspace',
            description: 'List all boards in a specific workspace',
            inputSchema: zodToJsonSchema(ListBoardsInWorkspaceSchema),
          },
          {
            name: 'get_active_board_info',
            description: 'Get information about the currently active board',
            inputSchema: zodToJsonSchema(GetActiveBoardInfoSchema),
          },
          {
            name: 'get_card',
            description: 'Get detailed information about a specific Trello card',
            inputSchema: zodToJsonSchema(GetCardSchema),
          },
          {
            name: 'add_comment',
            description: 'Add the given text as a new comment to the given card',
            inputSchema: zodToJsonSchema(AddCommentSchema),
          },
          {
            name: 'update_comment',
            description: 'Update the given comment with the new text',
            inputSchema: zodToJsonSchema(UpdateCommentSchema),
          },
          {
            name: 'delete_comment',
            description: 'Delete a comment from a Trello card',
            inputSchema: zodToJsonSchema(DeleteCommentSchema),
          },
          {
            name: 'get_card_comments',
            description: 'Retrieve all comments from a specific Trello card',
            inputSchema: zodToJsonSchema(GetCardCommentsSchema),
          },
          {
            name: 'create_checklist',
            description: 'Create a new checklist',
            inputSchema: zodToJsonSchema(CreateChecklistSchema),
          },
          {
            name: 'get_checklist_items',
            description: 'Get all items from a checklist by name',
            inputSchema: zodToJsonSchema(GetChecklistItemsSchema),
          },
          {
            name: 'add_checklist_item',
            description: 'Add a new item to a checklist',
            inputSchema: zodToJsonSchema(AddChecklistItemSchema),
          },
          {
            name: 'find_checklist_items_by_description',
            description: 'Search for checklist items containing specific text in their description',
            inputSchema: zodToJsonSchema(FindChecklistItemsByDescriptionSchema),
          },
          {
            name: 'get_acceptance_criteria',
            description: 'Get all items from the "Acceptance Criteria" checklist',
            inputSchema: zodToJsonSchema(GetAcceptanceCriteriaSchema),
          },
          {
            name: 'get_checklist_by_name',
            description: 'Get a complete checklist with all its items and completion percentage',
            inputSchema: zodToJsonSchema(GetChecklistByNameSchema),
          },
          {
            name: 'update_checklist_item',
            description: 'Update a checklist item state (mark as complete or incomplete)',
            inputSchema: zodToJsonSchema(UpdateChecklistItemSchema),
          },
          {
            name: 'get_board_members',
            description: 'Get all members of a specific board',
            inputSchema: zodToJsonSchema(GetBoardMembersSchema),
          },
          {
            name: 'assign_member_to_card',
            description: 'Assign a member to a specific card',
            inputSchema: zodToJsonSchema(AssignMemberToCardSchema),
          },
          {
            name: 'remove_member_from_card',
            description: 'Remove a member from a specific card',
            inputSchema: zodToJsonSchema(RemoveMemberFromCardSchema),
          },
          {
            name: 'get_board_labels',
            description: 'Get all labels of a specific board',
            inputSchema: zodToJsonSchema(GetBoardLabelsSchema),
          },
          {
            name: 'create_label',
            description: 'Create a new label on a board',
            inputSchema: zodToJsonSchema(CreateLabelSchema),
          },
          {
            name: 'update_label',
            description: 'Update an existing label',
            inputSchema: zodToJsonSchema(UpdateLabelSchema),
          },
          {
            name: 'delete_label',
            description: 'Delete a label from a board',
            inputSchema: zodToJsonSchema(DeleteLabelSchema),
          },
          {
            name: 'get_card_history',
            description: 'Get the history/actions of a specific card',
            inputSchema: zodToJsonSchema(GetCardHistorySchema),
          },
          {
            name: 'get_health',
            description: 'Basic health check of Trello connection',
            inputSchema: zodToJsonSchema(GetHealthSchema),
          },
          {
            name: 'get_health_detailed',
            description: 'Get comprehensive system health diagnostic with all subsystem checks',
            inputSchema: zodToJsonSchema(GetHealthDetailedSchema),
          },
          {
            name: 'get_health_metadata',
            description: 'Verify metadata consistency between boards, lists, cards, and checklists',
            inputSchema: zodToJsonSchema(GetHealthMetadataSchema),
          },
          {
            name: 'get_health_performance',
            description: 'Get detailed performance metrics and analysis',
            inputSchema: zodToJsonSchema(GetHealthPerformanceSchema),
          },
          {
            name: 'perform_system_repair',
            description: 'Attempt to automatically repair common system issues',
            inputSchema: zodToJsonSchema(PerformSystemRepairSchema),
          },
        ],
      };
    });

    // Handler 2: Call tools (with secret injection)
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async request => {
      try {
        const { params } = request;

        // Validate params.arguments exists
        if (!params.arguments) {
          throw new Error('Arguments are required');
        }

        // INJECT SECRETS BEFORE ZOD PARSING
        if (!params.arguments.trelloApiKey) {
          if (process.env.TRELLO_API_KEY != null && process.env.TRELLO_API_KEY.trim() !== '') {
            params.arguments.trelloApiKey = process.env.TRELLO_API_KEY;
          }
        }
        if (!params.arguments.trelloToken) {
          if (process.env.TRELLO_TOKEN != null && process.env.TRELLO_TOKEN.trim() !== '') {
            params.arguments.trelloToken = process.env.TRELLO_TOKEN;
          }
        }

        // Validate secrets are present
        if (!params.arguments.trelloApiKey || !params.arguments.trelloToken) {
          throw new Error(
            'Trello credentials required. Configure secrets "trelloApiKey" and "trelloToken" in Mission Squad, ' +
              'or set TRELLO_API_KEY and TRELLO_TOKEN environment variables.'
          );
        }

        // NOW PARSE WITH INTERNAL SCHEMAS AND HANDLE EACH TOOL
        switch (params.name) {
          case 'get_cards_by_list_id': {
            const args = _GetCardsByListIdSchema.parse(params.arguments);
            const cards = await this.trelloClient.getCardsByList(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.listId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }],
            };
          }

          case 'get_lists': {
            const args = _GetListsSchema.parse(params.arguments);
            const lists = await this.trelloClient.getLists(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(lists, null, 2) }],
            };
          }

          case 'get_recent_activity': {
            const args = _GetRecentActivitySchema.parse(params.arguments);
            const activity = await this.trelloClient.getRecentActivity(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.limit
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(activity, null, 2) }],
            };
          }

          case 'add_card_to_list': {
            const args = _AddCardToListSchema.parse(params.arguments);
            const card = await this.trelloClient.addCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'update_card_details': {
            const args = _UpdateCardDetailsSchema.parse(params.arguments);
            const card = await this.trelloClient.updateCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'archive_card': {
            const args = _ArchiveCardSchema.parse(params.arguments);
            const card = await this.trelloClient.archiveCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.cardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'move_card': {
            const args = _MoveCardSchema.parse(params.arguments);
            const card = await this.trelloClient.moveCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.cardId,
              args.listId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'add_list_to_board': {
            const args = _AddListToBoardSchema.parse(params.arguments);
            const list = await this.trelloClient.addList(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.name
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
            };
          }

          case 'archive_list': {
            const args = _ArchiveListSchema.parse(params.arguments);
            const list = await this.trelloClient.archiveList(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.listId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
            };
          }

          case 'get_my_cards': {
            const args = _GetMyCardsSchema.parse(params.arguments);
            const cards = await this.trelloClient.getMyCards(args.trelloApiKey, args.trelloToken);
            return {
              content: [{ type: 'text', text: JSON.stringify(cards, null, 2) }],
            };
          }

          case 'attach_image_to_card': {
            const args = _AttachImageToCardSchema.parse(params.arguments);
            const attachment = await this.trelloClient.attachImageToCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.cardId,
              args.imageUrl,
              args.name
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(attachment, null, 2) }],
            };
          }

          case 'attach_file_to_card': {
            const args = _AttachFileToCardSchema.parse(params.arguments);
            const attachment = await this.trelloClient.attachFileToCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.cardId,
              args.fileUrl,
              args.name,
              args.mimeType
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(attachment, null, 2) }],
            };
          }

          case 'attach_image_data_to_card': {
            const args = _AttachImageDataToCardSchema.parse(params.arguments);
            const attachment = await this.trelloClient.attachImageDataToCard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.cardId,
              args.imageData,
              args.name,
              args.mimeType
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(attachment, null, 2) }],
            };
          }

          case 'list_boards': {
            const args = _ListBoardsSchema.parse(params.arguments);
            const boards = await this.trelloClient.listBoards(args.trelloApiKey, args.trelloToken);
            return {
              content: [{ type: 'text', text: JSON.stringify(boards, null, 2) }],
            };
          }

          case 'set_active_board': {
            const args = _SetActiveBoardSchema.parse(params.arguments);
            const board = await this.trelloClient.setActiveBoard(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully set active board to "${board.name}" (${board.id})`,
                },
              ],
            };
          }

          case 'list_workspaces': {
            const args = _ListWorkspacesSchema.parse(params.arguments);
            const workspaces = await this.trelloClient.listWorkspaces(
              args.trelloApiKey,
              args.trelloToken
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(workspaces, null, 2) }],
            };
          }

          case 'create_board': {
            const args = _CreateBoardSchema.parse(params.arguments);
            const board = await this.trelloClient.createBoard(args.trelloApiKey, args.trelloToken, {
              name: args.name,
              desc: args.desc,
              idOrganization: args.idOrganization,
              defaultLabels: args.defaultLabels,
              defaultLists: args.defaultLists,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify(board, null, 2) }],
            };
          }

          case 'set_active_workspace': {
            const args = _SetActiveWorkspaceSchema.parse(params.arguments);
            const workspace = await this.trelloClient.setActiveWorkspace(
              args.trelloApiKey,
              args.trelloToken,
              args.workspaceId
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully set active workspace to "${workspace.displayName}" (${workspace.id})`,
                },
              ],
            };
          }

          case 'list_boards_in_workspace': {
            const args = _ListBoardsInWorkspaceSchema.parse(params.arguments);
            const boards = await this.trelloClient.listBoardsInWorkspace(
              args.trelloApiKey,
              args.trelloToken,
              args.workspaceId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(boards, null, 2) }],
            };
          }

          case 'get_active_board_info': {
            const args = _GetActiveBoardInfoSchema.parse(params.arguments);
            const boardId = this.trelloClient.activeBoardId;
            if (!boardId) {
              return {
                content: [{ type: 'text', text: 'No active board set' }],
                isError: true,
              };
            }
            const board = await this.trelloClient.getBoardById(
              args.trelloApiKey,
              args.trelloToken,
              boardId
            );
            return {
              content: [
                {
                  type: 'text',
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
          }

          case 'get_card': {
            const args = _GetCardSchema.parse(params.arguments);
            const card = await this.trelloClient.getCard(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.includeMarkdown
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'add_comment': {
            const args = _AddCommentSchema.parse(params.arguments);
            const comment = await this.trelloClient.addCommentToCard(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.text
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(comment, null, 2) }],
            };
          }

          case 'update_comment': {
            const args = _UpdateCommentSchema.parse(params.arguments);
            const success = await this.trelloClient.updateCommentOnCard(
              args.trelloApiKey,
              args.trelloToken,
              args.commentId,
              args.text
            );
            return {
              content: [{ type: 'text', text: success ? 'success' : 'failure' }],
            };
          }

          case 'delete_comment': {
            const args = _DeleteCommentSchema.parse(params.arguments);
            const success = await this.trelloClient.deleteCommentFromCard(
              args.trelloApiKey,
              args.trelloToken,
              args.commentId
            );
            return {
              content: [{ type: 'text', text: success ? 'success' : 'failure' }],
            };
          }

          case 'get_card_comments': {
            const args = _GetCardCommentsSchema.parse(params.arguments);
            const comments = await this.trelloClient.getCardComments(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.limit
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(comments, null, 2) }],
            };
          }

          case 'create_checklist': {
            const args = _CreateChecklistSchema.parse(params.arguments);
            const items = await this.trelloClient.createChecklist(
              args.trelloApiKey,
              args.trelloToken,
              args.name,
              args.cardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
            };
          }

          case 'get_checklist_items': {
            const args = _GetChecklistItemsSchema.parse(params.arguments);
            const items = await this.trelloClient.getChecklistItems(
              args.name,
              args.cardId,
              args.boardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
            };
          }

          case 'add_checklist_item': {
            const args = _AddChecklistItemSchema.parse(params.arguments);
            const item = await this.trelloClient.addChecklistItem(
              args.text,
              args.checkListName,
              args.cardId,
              args.boardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(item, null, 2) }],
            };
          }

          case 'find_checklist_items_by_description': {
            const args = _FindChecklistItemsByDescriptionSchema.parse(params.arguments);
            const items = await this.trelloClient.findChecklistItemsByDescription(
              args.description,
              args.cardId,
              args.boardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
            };
          }

          case 'get_acceptance_criteria': {
            const args = _GetAcceptanceCriteriaSchema.parse(params.arguments);
            const items = await this.trelloClient.getAcceptanceCriteria(args.cardId, args.boardId);
            return {
              content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
            };
          }

          case 'get_checklist_by_name': {
            const args = _GetChecklistByNameSchema.parse(params.arguments);
            const checklist = await this.trelloClient.getChecklistByName(
              args.name,
              args.cardId,
              args.boardId
            );
            if (!checklist) {
              return {
                content: [{ type: 'text', text: `Checklist "${args.name}" not found` }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify(checklist, null, 2) }],
            };
          }

          case 'update_checklist_item': {
            const args = _UpdateChecklistItemSchema.parse(params.arguments);
            const item = await this.trelloClient.updateChecklistItem(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.checkItemId,
              args.state
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(item, null, 2) }],
            };
          }

          case 'get_board_members': {
            const args = _GetBoardMembersSchema.parse(params.arguments);
            const members = await this.trelloClient.getBoardMembers(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(members, null, 2) }],
            };
          }

          case 'assign_member_to_card': {
            const args = _AssignMemberToCardSchema.parse(params.arguments);
            const card = await this.trelloClient.assignMemberToCard(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.memberId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'remove_member_from_card': {
            const args = _RemoveMemberFromCardSchema.parse(params.arguments);
            const card = await this.trelloClient.removeMemberFromCard(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.memberId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(card, null, 2) }],
            };
          }

          case 'get_board_labels': {
            const args = _GetBoardLabelsSchema.parse(params.arguments);
            const labels = await this.trelloClient.getBoardLabels(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(labels, null, 2) }],
            };
          }

          case 'create_label': {
            const args = _CreateLabelSchema.parse(params.arguments);
            const label = await this.trelloClient.createLabel(
              args.trelloApiKey,
              args.trelloToken,
              args.boardId,
              args.name,
              args.color
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(label, null, 2) }],
            };
          }

          case 'update_label': {
            const args = _UpdateLabelSchema.parse(params.arguments);
            const label = await this.trelloClient.updateLabel(
              args.trelloApiKey,
              args.trelloToken,
              args.labelId,
              args.name,
              args.color
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(label, null, 2) }],
            };
          }

          case 'delete_label': {
            const args = _DeleteLabelSchema.parse(params.arguments);
            await this.trelloClient.deleteLabel(args.trelloApiKey, args.trelloToken, args.labelId);
            return {
              content: [{ type: 'text', text: 'Label deleted successfully' }],
            };
          }

          case 'get_card_history': {
            const args = _GetCardHistorySchema.parse(params.arguments);
            const history = await this.trelloClient.getCardHistory(
              args.trelloApiKey,
              args.trelloToken,
              args.cardId,
              args.filter,
              args.limit
            );
            return {
              content: [{ type: 'text', text: JSON.stringify(history, null, 2) }],
            };
          }

          case 'get_health': {
            const args = _GetHealthSchema.parse(params.arguments);
            return await this.healthEndpoints.getBasicHealth(args.trelloApiKey, args.trelloToken);
          }

          case 'get_health_detailed': {
            const args = _GetHealthDetailedSchema.parse(params.arguments);
            return await this.healthEndpoints.getDetailedHealth(
              args.trelloApiKey,
              args.trelloToken
            );
          }

          case 'get_health_metadata': {
            const args = _GetHealthMetadataSchema.parse(params.arguments);
            return await this.healthEndpoints.getMetadataHealth(
              args.trelloApiKey,
              args.trelloToken
            );
          }

          case 'get_health_performance': {
            const args = _GetHealthPerformanceSchema.parse(params.arguments);
            return await this.healthEndpoints.getPerformanceHealth(
              args.trelloApiKey,
              args.trelloToken
            );
          }

          case 'perform_system_repair': {
            const args = _PerformSystemRepairSchema.parse(params.arguments);
            return await this.healthEndpoints.performRepair(args.trelloApiKey, args.trelloToken);
          }

          default:
            throw new Error(`Unknown tool: ${params.name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(`Invalid input: ${JSON.stringify(error.errors)}`);
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    // Load configuration before starting the server
    await this.trelloClient.loadConfig().catch(() => {
      // Continue with default config if loading fails
    });
    await this.mcpServer.connect(transport);
  }
}

const server = new TrelloServer();
server.run().catch(() => {
  // Silently handle errors to avoid interfering with MCP protocol
});
