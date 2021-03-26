// Copyright (c) 2021 Gitpod GmbH. All rights reserved.
// Licensed under the GNU Affero General Public License (AGPL).
// See License-AGPL.txt in the project root for license information.

package utils

import (
	"context"
	"net"
	"time"

	"github.com/gitpod-io/gitpod/common-go/log"
	"golang.org/x/time/rate"
)

// NewRateLimitedListen returns a net.Listen implementation that adds rate limiting.
func NewRateLimitedListen(ctx context.Context, refillInterval time.Duration, bucketSize int) func(network, address string) (net.Listener, error) {
	return func(network, address string) (net.Listener, error) {
		return newRateLimitedListener(
			ctx,
			network,
			address,
			refillInterval,
			bucketSize,
		)
	}
}

// RateLimitedListener adds rate limiting to the Accept function
// and delegates all requests to net.Listener.
type RateLimitedListener struct {
	delegate    net.Listener
	ctx         context.Context
	ratelimiter *rate.Limiter
}

// Accept waits for and returns the next connection to the listener.
// This implemenation delegates to net.Listener and adds rate limiting.
func (rll *RateLimitedListener) Accept() (conn net.Conn, err error) {
	conn, err = rll.delegate.Accept()
	if err != nil {
		return
	}
	log.WithField("remote addr", conn.RemoteAddr()).Debug("RateLimitedListener: new connection incoming")
	err = rll.ratelimiter.Wait(rll.ctx)
	if err != nil {
		log.
			WithError(err).
			WithField("remote addr", conn.RemoteAddr()).
			Info("RateLimitedListener: error from ratelimiter")
		return
	}
	return
}

// Close closes the listener.
// Any blocked Accept operations will be unblocked and return errors.
// This implemenation delegates to net.Listener.
func (rll *RateLimitedListener) Close() error {
	return rll.delegate.Close()
}

// Addr returns the listener's network address.
// This implemenation delegates to net.Listener.
func (rll *RateLimitedListener) Addr() net.Addr {
	return rll.delegate.Addr()
}

func newRateLimitedListener(ctx context.Context, network, address string, refillInterval time.Duration, bucketSize int) (*RateLimitedListener, error) {
	l, err := net.Listen(network, address)
	if err != nil {
		return nil, err
	}
	rll := &RateLimitedListener{
		delegate:    l,
		ctx:         ctx,
		ratelimiter: rate.NewLimiter(rate.Every(time.Duration(refillInterval)), bucketSize),
	}
	return rll, nil
}
