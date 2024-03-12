package graph

// This file will be automatically regenerated based on the schema, any resolver implementations
// will be copied through when generating and any unknown code will be moved to the end.
// Code generated by github.com/99designs/gqlgen version v0.17.45

import (
	"context"
	"encoding/json"
	"time"

	"github.com/DmitriyVTitov/size"
	"github.com/aws/smithy-go/ptr"
	"github.com/google/uuid"
	kafkaqueue "github.com/highlight-run/highlight/backend/kafka-queue"
	"github.com/highlight-run/highlight/backend/model"
	generated1 "github.com/highlight-run/highlight/backend/public-graph/graph/generated"
	customModels "github.com/highlight-run/highlight/backend/public-graph/graph/model"
	"github.com/highlight-run/highlight/backend/util"
	hlog "github.com/highlight/highlight/sdk/highlight-go/log"
	"github.com/openlyinc/pointy"
	e "github.com/pkg/errors"
	"github.com/samber/lo"
	log "github.com/sirupsen/logrus"
	"golang.org/x/sync/errgroup"
)

// InitializeSession is the resolver for the initializeSession field.
func (r *mutationResolver) InitializeSession(ctx context.Context, sessionSecureID string, organizationVerboseID string, enableStrictPrivacy bool, enableRecordingNetworkContents bool, clientVersion string, firstloadVersion string, clientConfig string, environment string, appVersion *string, serviceName *string, fingerprint string, clientID string, networkRecordingDomains []string, disableSessionRecording *bool, privacySetting *string) (*customModels.InitializeSessionResponse, error) {
	s, ctx := util.StartSpanFromContext(ctx, "gql.initializeSession", util.ResourceName("gql.initializeSession"), util.Tag("secure_id", sessionSecureID), util.Tag("client_version", clientVersion), util.Tag("firstload_version", firstloadVersion))
	defer s.Finish()
	acceptLanguageString := ctx.Value(model.ContextKeys.AcceptLanguage).(string)
	userAgentString := ctx.Value(model.ContextKeys.UserAgent).(string)
	ip := ctx.Value(model.ContextKeys.IP).(string)

	projectID, err := model.FromVerboseID(organizationVerboseID)
	if err != nil {
		log.WithContext(ctx).Errorf("An unsupported verboseID was used: %s, %s", organizationVerboseID, clientConfig)
	} else {
		err = r.ProducerQueue.Submit(ctx, sessionSecureID, &kafkaqueue.Message{
			Type: kafkaqueue.InitializeSession,
			InitializeSession: &kafkaqueue.InitializeSessionArgs{
				SessionSecureID:                sessionSecureID,
				CreatedAt:                      time.Now(),
				ProjectVerboseID:               organizationVerboseID,
				EnableStrictPrivacy:            enableStrictPrivacy,
				PrivacySetting:                 privacySetting,
				EnableRecordingNetworkContents: enableRecordingNetworkContents,
				ClientVersion:                  clientVersion,
				FirstloadVersion:               firstloadVersion,
				ClientConfig:                   clientConfig,
				Environment:                    environment,
				AppVersion:                     appVersion,
				ServiceName:                    ptr.ToString(serviceName),
				Fingerprint:                    fingerprint,
				UserAgent:                      userAgentString,
				AcceptLanguage:                 acceptLanguageString,
				IP:                             ip,
				ClientID:                       clientID,
				NetworkRecordingDomains:        networkRecordingDomains,
				DisableSessionRecording:        disableSessionRecording,
			},
		})
		if err == nil {
			err = r.Redis.SetIsPendingSession(ctx, sessionSecureID, true)
		}
		if err == nil {
			exceeded, err := r.Redis.IsBillingQuotaExceeded(ctx, projectID, model.PricingProductTypeSessions)
			if err == nil && exceeded != nil && *exceeded {
				err = e.New(string(customModels.PublicGraphErrorBillingQuotaExceeded))
			}
		}
	}

	s.SetAttribute("success", err == nil)

	return &customModels.InitializeSessionResponse{
		SecureID:  sessionSecureID,
		ProjectID: projectID,
	}, err
}

// IdentifySession is the resolver for the identifySession field.
func (r *mutationResolver) IdentifySession(ctx context.Context, sessionSecureID string, userIdentifier string, userObject interface{}) (string, error) {
	err := r.ProducerQueue.Submit(ctx, sessionSecureID, &kafkaqueue.Message{
		Type: kafkaqueue.IdentifySession,
		IdentifySession: &kafkaqueue.IdentifySessionArgs{
			SessionSecureID: sessionSecureID,
			UserIdentifier:  userIdentifier,
			UserObject:      userObject,
		},
	})
	return sessionSecureID, err
}

// AddSessionProperties is the resolver for the addSessionProperties field.
func (r *mutationResolver) AddSessionProperties(ctx context.Context, sessionSecureID string, propertiesObject interface{}) (string, error) {
	err := r.ProducerQueue.Submit(ctx, sessionSecureID, &kafkaqueue.Message{
		Type: kafkaqueue.AddSessionProperties,
		AddSessionProperties: &kafkaqueue.AddSessionPropertiesArgs{
			SessionSecureID:  sessionSecureID,
			PropertiesObject: propertiesObject,
		},
	})
	return sessionSecureID, err
}

// PushPayload is the resolver for the pushPayload field.
func (r *mutationResolver) PushPayload(ctx context.Context, sessionSecureID string, payloadID *int, events customModels.ReplayEventsInput, messages string, resources string, webSocketEvents *string, errors []*customModels.ErrorObjectInput, isBeacon *bool, hasSessionUnloaded *bool, highlightLogs *string) (int, error) {
	if payloadID == nil {
		payloadID = pointy.Int(0)
	}

	const smallChunkSize = 1024
	const largeChunkSize = 1

	var logRows []*hlog.Message
	var resourcesParsed PushPayloadResources
	var webSocketEventsParsed PushPayloadWebSocketEvents

	var g errgroup.Group
	g.Go(func() error {
		var err error
		logRows, err = hlog.ParseConsoleMessages(messages)
		return err
	})
	g.Go(func() error {
		return json.Unmarshal([]byte(resources), &resourcesParsed)
	})
	g.Go(func() error {
		if webSocketEvents == nil {
			return nil
		}
		return json.Unmarshal([]byte(*webSocketEvents), &webSocketEventsParsed)
	})
	if err := g.Wait(); err != nil {
		return 0, err
	}

	chunks := map[int]PushPayloadChunk{
		0: {
			events: events.Events,
			errors: errors,
		},
	}
	for idx, chunk := range lo.Chunk(logRows, smallChunkSize) {
		if _, ok := chunks[idx]; !ok {
			chunks[idx] = PushPayloadChunk{}
		}
		entry := chunks[idx]
		entry.logRows = chunk
		chunks[idx] = entry
	}
	for idx, chunk := range lo.Chunk(resourcesParsed.Resources, largeChunkSize) {
		if _, ok := chunks[idx]; !ok {
			chunks[idx] = PushPayloadChunk{}
		}
		entry := chunks[idx]
		entry.resources = chunk
		chunks[idx] = entry
	}
	for idx, chunk := range lo.Chunk(webSocketEventsParsed.WebSocketEvents, smallChunkSize) {
		if _, ok := chunks[idx]; !ok {
			chunks[idx] = PushPayloadChunk{}
		}
		entry := chunks[idx]
		entry.websocketEvents = chunk
		chunks[idx] = entry
	}

	var msgs []kafkaqueue.RetryableMessage
	for _, chunk := range chunks {
		logRowsB, err := json.Marshal(PushPayloadMessages{
			Messages: chunk.logRows,
		})
		if err != nil {
			return 0, err
		}
		resourcesB, err := json.Marshal(PushPayloadResources{
			Resources: chunk.resources,
		})
		if err != nil {
			return 0, err
		}
		var webSocketEventsPtr *string
		if chunk.websocketEvents != nil {
			websocketEventsB, err := json.Marshal(PushPayloadWebSocketEvents{
				WebSocketEvents: chunk.websocketEvents,
			})
			if err != nil {
				return 0, err
			}
			webSocketEventsPtr = ptr.String(string(websocketEventsB))
		}
		msgs = append(msgs, &kafkaqueue.Message{
			Type: kafkaqueue.PushPayload,
			PushPayload: &kafkaqueue.PushPayloadArgs{
				SessionSecureID: sessionSecureID,
				Events: customModels.ReplayEventsInput{
					Events: chunk.events,
				},
				Messages:           string(logRowsB),
				Resources:          string(resourcesB),
				WebSocketEvents:    webSocketEventsPtr,
				Errors:             chunk.errors,
				IsBeacon:           isBeacon,
				HasSessionUnloaded: hasSessionUnloaded,
				HighlightLogs:      highlightLogs,
				PayloadID:          payloadID,
			},
		})
	}
	err := r.ProducerQueue.Submit(ctx, sessionSecureID, msgs...)
	return size.Of(events), err
}

// PushPayloadCompressed is the resolver for the pushPayloadCompressed field.
func (r *mutationResolver) PushPayloadCompressed(ctx context.Context, sessionSecureID string, payloadID int, data string) (interface{}, error) {
	return nil, r.ProducerQueue.Submit(ctx, sessionSecureID, &kafkaqueue.Message{
		Type: kafkaqueue.PushCompressedPayload,
		PushCompressedPayload: &kafkaqueue.PushCompressedPayloadArgs{
			SessionSecureID: sessionSecureID,
			PayloadID:       payloadID,
			Data:            data,
		},
	})
}

// PushBackendPayload is the resolver for the pushBackendPayload field.
func (r *mutationResolver) PushBackendPayload(ctx context.Context, projectID *string, errors []*customModels.BackendErrorObjectInput) (interface{}, error) {
	errorsBySecureID := map[*string][]*customModels.BackendErrorObjectInput{}
	for _, backendError := range errors {
		errorsBySecureID[backendError.SessionSecureID] = append(errorsBySecureID[backendError.SessionSecureID], backendError)
	}
	var messages []kafkaqueue.RetryableMessage
	for secureID, backendErrors := range errorsBySecureID {
		var partitionKey string
		if secureID != nil {
			partitionKey = *secureID
		} else if projectID != nil {
			partitionKey = uuid.New().String()
		}
		for _, backendError := range backendErrors {
			messages = append(messages, &kafkaqueue.Message{
				Type: kafkaqueue.PushBackendPayload,
				PushBackendPayload: &kafkaqueue.PushBackendPayloadArgs{
					ProjectVerboseID: projectID,
					SessionSecureID:  secureID,
					Errors:           []*customModels.BackendErrorObjectInput{backendError},
				}})
		}
		err := r.ProducerQueue.Submit(ctx, partitionKey, messages...)
		if err != nil {
			log.WithContext(ctx).WithFields(log.Fields{"project_id": projectID, "secure_id": secureID}).
				Error(e.Wrap(err, "failed to send kafka message for push backend payload."))
		}
	}
	return nil, nil
}

// PushMetrics is the resolver for the pushMetrics field.
func (r *mutationResolver) PushMetrics(ctx context.Context, metrics []*customModels.MetricInput) (int, error) {
	return r.SubmitMetricsMessage(ctx, metrics)
}

// Deprecated: MarkBackendSetup is the resolver for the markBackendSetup field. This may be used by old SDKs but is a NOOP
func (r *mutationResolver) MarkBackendSetup(ctx context.Context, projectID *string, sessionSecureID *string, typeArg *string) (interface{}, error) {
	return nil, nil
}

// AddSessionFeedback is the resolver for the addSessionFeedback field.
func (r *mutationResolver) AddSessionFeedback(ctx context.Context, sessionSecureID string, userName *string, userEmail *string, verbatim string, timestamp time.Time) (string, error) {
	err := r.ProducerQueue.Submit(ctx, sessionSecureID, &kafkaqueue.Message{
		Type: kafkaqueue.AddSessionFeedback,
		AddSessionFeedback: &kafkaqueue.AddSessionFeedbackArgs{
			SessionSecureID: sessionSecureID,
			UserName:        userName,
			UserEmail:       userEmail,
			Verbatim:        verbatim,
			Timestamp:       timestamp,
		}})

	return sessionSecureID, err
}

// Ignore is the resolver for the ignore field.
func (r *queryResolver) Ignore(ctx context.Context, id int) (interface{}, error) {
	return nil, nil
}

// OrganizationID is the resolver for the organization_id field.
func (r *sessionResolver) OrganizationID(ctx context.Context, obj *model.Session) (int, error) {
	return obj.ProjectID, nil
}

// Mutation returns generated1.MutationResolver implementation.
func (r *Resolver) Mutation() generated1.MutationResolver { return &mutationResolver{r} }

// Query returns generated1.QueryResolver implementation.
func (r *Resolver) Query() generated1.QueryResolver { return &queryResolver{r} }

// Session returns generated1.SessionResolver implementation.
func (r *Resolver) Session() generated1.SessionResolver { return &sessionResolver{r} }

type mutationResolver struct{ *Resolver }
type queryResolver struct{ *Resolver }
type sessionResolver struct{ *Resolver }
